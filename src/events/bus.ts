import { EventEmitter } from "node:events";

/**
 * In-memory pub/sub for Zalo events.
 *
 * Memory characteristics:
 *   - Per published event, allocates ONE { accountId, type, ts, data } object.
 *   - If `listenerCount(accountId) === 0` AND `listenerCount("*") === 0`, the
 *     publish is short-circuited — no allocation, no emit. This means dropping
 *     all WebSocket clients on an account effectively pauses the bus for it.
 *   - Subscribers attach via `on(channel, handler)` and detach via the returned
 *     unsubscribe function — no global registry, GC handles the rest.
 *
 * Producers (zca-js Listener wired in src/events/listener.ts) → publish.
 * Consumers (src/events/ws.ts) → subscribeAccount or subscribeAll.
 */

export type ZaloEventType =
    | "message"
    | "reaction"
    | "undo"
    | "group_event"
    | "friend_event"
    | "typing"
    | "seen_messages"
    | "delivered_messages"
    | "upload_attachment"
    | "connected"
    | "disconnected"
    | "closed"
    | "error";

export interface ZaloBusEvent {
    accountId: string;
    type: ZaloEventType;
    /** Wall-clock when the event entered the bus. */
    ts: number;
    /** Raw zca-js event payload (shape varies by type). */
    data: unknown;
}

class ZaloEventBus extends EventEmitter {
    /**
     * Emit one event. Skips entirely if no consumers for either the per-account
     * channel or the wildcard "*" channel — saves the object allocation and
     * EventEmitter overhead when the listener is running but nobody's watching.
     */
    publish(accountId: string, type: ZaloEventType, data: unknown): void {
        const accountListeners = super.listenerCount(accountId);
        const wildListeners = super.listenerCount("*");
        if (accountListeners === 0 && wildListeners === 0) return;

        const ev: ZaloBusEvent = { accountId, type, ts: Date.now(), data };
        if (accountListeners > 0) super.emit(accountId, ev);
        if (wildListeners > 0) super.emit("*", ev);
    }

    /** Subscribe to one account's events. Returns an unsubscribe function. */
    subscribeAccount(accountId: string, handler: (ev: ZaloBusEvent) => void): () => void {
        super.on(accountId, handler);
        return () => super.off(accountId, handler);
    }

    /** Subscribe to ALL accounts' events. */
    subscribeAll(handler: (ev: ZaloBusEvent) => void): () => void {
        super.on("*", handler);
        return () => super.off("*", handler);
    }

    /** Number of subscribers for one account (used for lazy-attach decisions). */
    accountSubscriberCount(accountId: string): number {
        return super.listenerCount(accountId) + super.listenerCount("*");
    }
}

export const eventBus = new ZaloEventBus();
// Each WebSocket client adds 1-2 listeners. Default cap of 10 is too tight.
eventBus.setMaxListeners(0);
