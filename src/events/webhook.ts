import { createHmac } from "node:crypto";
import { logger } from "../logger.js";
import {
    getAccountInternal,
    listAccountsWithWebhook,
} from "../db/accounts.js";
import { eventBus, type ZaloBusEvent } from "./bus.js";
import { noteSubscribe, noteUnsubscribe } from "./orchestrator.js";

/**
 * Webhook dispatcher.
 *
 * Subscribes to the bus PER-ACCOUNT (not wildcard) so:
 *   1. Accounts without `webhookUrl` add zero overhead.
 *   2. Each subscription registers as a consumer with the lazy orchestrator,
 *      so the underlying zca-js listener auto-attaches when at least one
 *      account has a webhook configured (or a WS client is subscribed).
 *
 * The webhook config (URL, secret, uid) is cached IN THE SUBSCRIPTION CLOSURE
 * so events fire-and-deliver without a round trip to MongoDB. PATCH calls
 * `refreshWebhookForAccount` which rebinds the closure with fresh config.
 *
 * Delivery: HTTP POST with HMAC-SHA256 (`X-Signature: sha256=<hex>`) when
 * `webhookSecret` is set. 8s timeout. 1 retry on 5xx / network error.
 */

const TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 2_000;

interface CachedConfig {
    url: string;
    secret: string | null;
    uid: string;
}

interface Subscription {
    cfg: CachedConfig;
    unsubscribeFromBus: () => void;
}

const subs = new Map<string, Subscription>();

export async function startWebhookDispatcher(): Promise<void> {
    const accounts = await listAccountsWithWebhook();
    for (const acc of accounts) {
        if (acc.webhookUrl) {
            await bind(acc._id);
        }
    }
    logger.info({ accounts: subs.size }, "webhook dispatcher started");
}

/** Re-evaluate one account's webhook subscription after a config change. */
export async function refreshWebhookForAccount(accountId: string): Promise<void> {
    const acc = await getAccountInternal(accountId);
    const wantSubscribed = !!(acc && acc.webhookUrl);
    const currently = subs.has(accountId);

    if (!wantSubscribed) {
        if (currently) unbind(accountId);
        return;
    }
    // Wanted: rebind so the closure picks up the new URL/secret/uid.
    if (currently) unbind(accountId);
    await bind(accountId);
}

async function bind(accountId: string): Promise<void> {
    const acc = await getAccountInternal(accountId);
    if (!acc?.webhookUrl) return;

    const cfg: CachedConfig = {
        url: acc.webhookUrl,
        secret: acc.webhookSecret ?? null,
        uid: acc.uid,
    };

    const handler = (ev: ZaloBusEvent) => {
        // Closure captures cfg — no DB round-trip per event.
        void deliver(ev, cfg).catch((err) =>
            logger.error({ err, accountId: ev.accountId }, "webhook delivery error"),
        );
    };

    const unsubscribeFromBus = eventBus.subscribeAccount(accountId, handler);
    subs.set(accountId, { cfg, unsubscribeFromBus });
    void noteSubscribe(accountId);
}

function unbind(accountId: string): void {
    const s = subs.get(accountId);
    if (!s) return;
    s.unsubscribeFromBus();
    subs.delete(accountId);
    noteUnsubscribe(accountId);
}

async function deliver(ev: ZaloBusEvent, cfg: CachedConfig): Promise<void> {
    const body = JSON.stringify({
        accountId: ev.accountId,
        uid: cfg.uid,
        type: ev.type,
        ts: ev.ts,
        data: ev.data,
    });

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "zalo-auto/0.1 webhook",
        "X-Event-Type": ev.type,
        "X-Account-Id": ev.accountId,
    };
    if (cfg.secret) {
        const sig = createHmac("sha256", cfg.secret).update(body).digest("hex");
        headers["X-Signature"] = `sha256=${sig}`;
    }

    const post = async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(cfg.url, {
                method: "POST",
                headers,
                body,
                signal: ctrl.signal,
            });
            return { ok: res.ok, status: res.status };
        } finally {
            clearTimeout(t);
        }
    };

    try {
        const r = await post();
        if (r.ok) return;
        if (r.status >= 400 && r.status < 500) {
            logger.warn(
                { accountId: ev.accountId, status: r.status },
                "webhook 4xx — not retrying",
            );
            return;
        }
        await sleep(RETRY_DELAY_MS);
        const r2 = await post();
        if (!r2.ok) {
            logger.warn(
                { accountId: ev.accountId, status: r2.status },
                "webhook delivery failed after retry",
            );
        }
    } catch (err) {
        await sleep(RETRY_DELAY_MS);
        try {
            await post();
        } catch (err2) {
            logger.error({ err: err2, accountId: ev.accountId }, "webhook gave up");
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}
