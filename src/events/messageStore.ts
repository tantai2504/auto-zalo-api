import { logger } from "../logger.js";
import { eventBus, type ZaloBusEvent } from "./bus.js";
import { saveMessage } from "../db/messages.js";
import { getAccountById } from "../db/accounts.js";

/**
 * Wildcard subscriber that persists every incoming `message` event into the
 * `messages` MongoDB collection.
 *
 * Why DB instead of in-RAM buffer:
 *   - Survives server restarts (PM2/cPanel) — n8n cron polling keeps working
 *   - Multi-instance friendly (one collection, one source of truth)
 *   - Supports `since`-based incremental pulls
 *   - 30-day TTL keeps the collection bounded
 *
 * Adding this as a wildcard bus subscriber means: whenever the listener for
 * any account is attached and fires a `message` event, we capture it.
 * Listener auto-attaches when there's a consumer (WebSocket / webhook URL).
 */

let started = false;

export function startMessageStore(): void {
    if (started) return;
    started = true;
    eventBus.subscribeAll((ev) => {
        if (ev.type !== "message") return;
        void handle(ev).catch((err) =>
            logger.warn({ err, accountId: ev.accountId }, "messageStore handle failed"),
        );
    });
    logger.info("message store ready (mongo-backed, 30d TTL)");
}

async function handle(ev: ZaloBusEvent): Promise<void> {
    const parsed = parseZaloMessage(ev.data);
    if (!parsed) return;
    const acc = await getAccountById(ev.accountId);
    if (!acc) return;
    await saveMessage({
        accountId: ev.accountId,
        uid: acc.uid,
        threadType: parsed.threadType,
        threadId: parsed.threadId,
        fromUid: parsed.fromUid,
        msgId: parsed.msgId,
        cliMsgId: parsed.cliMsgId,
        msgType: parsed.msgType,
        content: parsed.content,
        ts: parsed.ts,
    });
}

// ---- Zalo message parser ----

interface ParsedMessage {
    threadType: 0 | 1;
    threadId: string;
    fromUid: string;
    msgId: string;
    cliMsgId: string;
    msgType: string;
    content: unknown;
    ts: number;
}

/**
 * Pull the fields we need out of zca-js's Message shape. Both UserMessage
 * and GroupMessage expose `data` with similar fields; we accept anything
 * that looks message-like and skip what doesn't.
 */
function parseZaloMessage(raw: unknown): ParsedMessage | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    let threadType: 0 | 1;
    const t = r.type;
    if (t === "user" || t === 0) threadType = 0;
    else if (t === "group" || t === 1) threadType = 1;
    else return null;

    const threadId = typeof r.threadId === "string" ? r.threadId : "";
    if (!threadId) return null;

    const data = (r.data ?? r) as Record<string, unknown>;
    const msgId = String(data.msgId ?? "");
    if (!msgId) return null;

    return {
        threadType,
        threadId,
        fromUid: String(data.uidFrom ?? data.fromUid ?? ""),
        msgId,
        cliMsgId: String(data.cliMsgId ?? ""),
        msgType: String(data.msgType ?? "chat.unknown"),
        content: data.content ?? null,
        ts: numberOf(data.ts) ?? Date.now(),
    };
}

function numberOf(v: unknown): number | null {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
