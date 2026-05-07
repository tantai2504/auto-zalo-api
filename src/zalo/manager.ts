import { Zalo } from "zca-js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
    getAccountInternal,
    getAccountWithCredentials,
    listAccounts,
    touchAccount,
    type AccountPublic,
} from "../db/accounts.js";
import { attachListener, detachListener } from "../events/listener.js";
import type { StoredCredentials } from "./types.js";

type ZaloApi = Awaited<ReturnType<Zalo["login"]>>;

interface PoolEntry {
    api: ZaloApi;
    accountId: string;
    startedAt: number;
    lastUsedAt: number;
}

/**
 * In-memory pool of live zca-js sessions, keyed by account id.
 * Sessions are lazily created on first use and reused across requests.
 *
 * NOT thread-safe across processes — for horizontal scaling, swap this out
 * for a sticky-session router or move sessions into a worker pool.
 */
class SessionManager {
    private pool = new Map<string, PoolEntry>();
    private inflight = new Map<string, Promise<ZaloApi>>();

    async get(accountId: string): Promise<ZaloApi> {
        const cached = this.pool.get(accountId);
        if (cached) {
            cached.lastUsedAt = Date.now();
            void touchAccount(accountId).catch(() => {});
            return cached.api;
        }
        const pending = this.inflight.get(accountId);
        if (pending) return pending;

        const promise = this.create(accountId).finally(() => {
            this.inflight.delete(accountId);
        });
        this.inflight.set(accountId, promise);
        return promise;
    }

    private async create(accountId: string): Promise<ZaloApi> {
        const account = await getAccountWithCredentials(accountId);
        if (!account) throw new Error(`Account not found: ${accountId}`);

        const zalo = new Zalo({
            selfListen: false,
            checkUpdate: false,
            logging: false,
        });

        const api = await zalo.login({
            cookie: account.credentials.cookie,
            imei: account.credentials.imei,
            userAgent: account.credentials.userAgent,
            language: account.credentials.language,
        });

        const now = Date.now();
        this.pool.set(accountId, { api, accountId, startedAt: now, lastUsedAt: now });
        await touchAccount(accountId);
        logger.info({ accountId, uid: account.uid }, "zalo session ready");

        // Auto-attach listener if user previously enabled it.
        const fullDoc = await getAccountInternal(accountId);
        if (fullDoc?.listenerEnabled === true) {
            attachListener(accountId, api);
        }

        return api;
    }

    invalidate(accountId: string): void {
        const entry = this.pool.get(accountId);
        if (entry) {
            try {
                detachListener(entry.api);
            } catch {}
        }
        this.pool.delete(accountId);
    }

    /** Force-start the listener on an existing or fresh session. */
    async startListener(accountId: string): Promise<void> {
        const api = await this.get(accountId);
        attachListener(accountId, api);
    }

    /** Stop the listener WITHOUT invalidating the session (still usable for API calls). */
    stopListener(accountId: string): void {
        const entry = this.pool.get(accountId);
        if (!entry) return;
        detachListener(entry.api);
    }

    listLive(): string[] {
        return [...this.pool.keys()];
    }

    async warmAll(): Promise<void> {
        const accounts = await listAccounts();
        for (const acc of accounts) {
            if (acc.status !== "active") continue;
            try {
                await this.get(acc.id);
            } catch (err) {
                logger.error({ err, accountId: acc.id }, "warm session failed");
            }
        }
    }

    /**
     * Ping every live session via `keepAlive()`. Sessions that fail get
     * dropped from the pool so the next request will re-create them.
     */
    async keepAliveAll(): Promise<{ ok: number; dropped: number }> {
        let ok = 0;
        let dropped = 0;
        for (const [accountId, entry] of this.pool.entries()) {
            try {
                const fn = (entry.api as unknown as { keepAlive?: () => Promise<unknown> }).keepAlive;
                if (typeof fn !== "function") continue;
                await fn.call(entry.api);
                ok++;
            } catch (err) {
                logger.warn({ err, accountId }, "keepAlive failed; dropping session");
                this.pool.delete(accountId);
                dropped++;
            }
        }
        return { ok, dropped };
    }

    poolSize(): number {
        return this.pool.size;
    }

    /**
     * Drop sessions that haven't been touched in `idleMs`. Called periodically.
     * Sessions held by an active listener (event consumer) are NOT dropped —
     * we know they're being used.
     */
    evictIdle(idleMs: number, isPinned: (accountId: string) => boolean): number {
        const cutoff = Date.now() - idleMs;
        let evicted = 0;
        for (const [accountId, entry] of this.pool.entries()) {
            if (entry.lastUsedAt > cutoff) continue;
            if (isPinned(accountId)) continue;
            this.invalidate(accountId);
            evicted++;
        }
        return evicted;
    }
}

export const sessions = new SessionManager();

let keepAliveTimer: NodeJS.Timeout | null = null;
let keepAliveStopped = false;

/**
 * Background keep-alive that pings every live session via api.keepAlive().
 *
 * Uses a setTimeout chain (not setInterval) so a slow tick can't overlap with
 * the next one — important when the pool grows and keepAliveAll takes longer
 * than the interval.
 */
export function startKeepAliveLoop(): void {
    if (keepAliveTimer || keepAliveStopped) return;
    const sec = config.KEEPALIVE_INTERVAL_SEC;
    if (sec === 0) return;

    const tick = async () => {
        try {
            const r = await sessions.keepAliveAll();
            if (r.ok || r.dropped) {
                logger.debug({ ...r, total: sessions.poolSize() }, "keepAlive tick");
            }
        } catch (err) {
            logger.error({ err }, "keepAlive loop error");
        } finally {
            if (!keepAliveStopped) {
                keepAliveTimer = setTimeout(tick, sec * 1000);
                keepAliveTimer.unref?.();
            }
        }
    };

    keepAliveTimer = setTimeout(tick, sec * 1000);
    keepAliveTimer.unref?.();
    logger.info({ intervalSec: sec }, "keepAlive loop started");
}

export function stopKeepAliveLoop(): void {
    keepAliveStopped = true;
    if (keepAliveTimer) {
        clearTimeout(keepAliveTimer);
        keepAliveTimer = null;
    }
}

let idleTimer: NodeJS.Timeout | null = null;
let idleStopped = false;

/**
 * Background eviction of idle sessions. Sessions touched within IDLE_EVICT_AFTER_SEC
 * stay; older ones are dropped (unless pinned by an active listener consumer).
 * Sweeps every 10 minutes — much rarer than keep-alive since this is a memory
 * housekeeping concern, not a Zalo session liveness concern.
 */
export function startIdleEvictionLoop(isPinned: (accountId: string) => boolean): void {
    if (idleTimer || idleStopped) return;
    const idleSec = config.IDLE_EVICT_AFTER_SEC;
    if (idleSec === 0) return;

    const sweep = () => {
        try {
            const evicted = sessions.evictIdle(idleSec * 1000, isPinned);
            if (evicted > 0) {
                logger.info({ evicted, remaining: sessions.poolSize() }, "idle sessions evicted");
            }
        } catch (err) {
            logger.error({ err }, "idle eviction error");
        } finally {
            if (!idleStopped) {
                idleTimer = setTimeout(sweep, 10 * 60 * 1000);
                idleTimer.unref?.();
            }
        }
    };

    idleTimer = setTimeout(sweep, 10 * 60 * 1000);
    idleTimer.unref?.();
    logger.info({ idleSec }, "idle eviction loop started");
}

export function stopIdleEvictionLoop(): void {
    idleStopped = true;
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

export async function withSession<T>(
    account: AccountPublic,
    fn: (api: ZaloApi) => Promise<T>,
): Promise<T> {
    const api = await sessions.get(account.id);
    return fn(api);
}

export function dropSession(accountId: string): void {
    sessions.invalidate(accountId);
}

export function persistedCredentialsToInput(c: StoredCredentials) {
    return {
        cookie: c.cookie,
        imei: c.imei,
        userAgent: c.userAgent,
        language: c.language,
    };
}
