import type { Zalo } from "zca-js";
import { logger } from "../logger.js";
import { eventBus, type ZaloEventType } from "./bus.js";
import { dropSession } from "../zalo/manager.js";

type ZaloApi = Awaited<ReturnType<Zalo["login"]>>;

/**
 * Event types we forward from the zca-js Listener to the bus.
 * `connected/disconnected/closed/error` are also forwarded so consumers can
 * track session health.
 */
const FORWARDED: ZaloEventType[] = [
    "message",
    "reaction",
    "undo",
    "group_event",
    "friend_event",
    "typing",
    "seen_messages",
    "delivered_messages",
    "upload_attachment",
    "connected",
    "disconnected",
    "closed",
    "error",
];

const attached = new WeakSet<object>();

/**
 * Wire the api.listener to the EventBus and start it. Idempotent — calling
 * twice on the same api instance is a no-op.
 */
export function attachListener(accountId: string, api: ZaloApi): void {
    const listener = (api as unknown as { listener: ZcaListener }).listener;
    if (!listener) {
        logger.warn({ accountId }, "api.listener missing — cannot attach");
        return;
    }
    if (attached.has(listener as unknown as object)) return;
    attached.add(listener as unknown as object);

    for (const type of FORWARDED) {
        listener.on(type, (...args: unknown[]) => {
            // Most events have a single payload; emit args[0] when there's only
            // one, otherwise emit the whole array so consumers can destructure.
            const data = args.length === 1 ? args[0] : args;
            eventBus.publish(accountId, type, data);
        });
    }

    // Drop the session from the pool when zca-js gives up. Otherwise the next
    // /api call would reuse a dead WebSocket and fail. Lazy re-create on demand.
    listener.on("closed", (code: unknown, reason: unknown) => {
        logger.warn({ accountId, code, reason }, "zca-js listener closed; dropping session");
        try { dropSession(accountId); } catch {}
    });
    listener.on("error", (err: unknown) => {
        logger.warn({ accountId, err }, "zca-js listener error; dropping session");
        try { dropSession(accountId); } catch {}
    });

    listener.start({ retryOnClose: true });
    logger.info({ accountId }, "zca-js listener attached + started");
}

export function detachListener(api: ZaloApi): void {
    const listener = (api as unknown as { listener: ZcaListener }).listener;
    if (!listener) return;
    try {
        listener.stop();
    } catch (err) {
        logger.warn({ err }, "listener.stop() threw");
    }
    listener.removeAllListeners?.();
    attached.delete(listener as unknown as object);
}

interface ZcaListener {
    on(event: string, handler: (...args: unknown[]) => void): unknown;
    removeAllListeners?: () => unknown;
    start(opts?: { retryOnClose?: boolean }): unknown;
    stop(): unknown;
}
