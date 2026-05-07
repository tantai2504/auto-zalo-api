import { logger } from "../logger.js";
import { getAccountInternal } from "../db/accounts.js";
import { sessions } from "../zalo/manager.js";

/**
 * Lazy listener orchestrator — attach the zca-js listener for an account only
 * when at least one consumer is interested, and detach (after a grace period)
 * when the last consumer leaves.
 *
 * Consumers register themselves explicitly:
 *   - Each WebSocket subscription = 1 consumer
 *   - Each configured webhook URL  = 1 consumer
 *
 * Why lazy: the zca-js listener holds an open WebSocket to Zalo for every
 * attached account. Idle connections waste RAM/CPU/sockets. Pinning attach to
 * actual consumers keeps the cost proportional to demand.
 *
 * Honors `account.listenerEnabled` as a kill switch — if false, we never
 * attach even when consumers register. Toggle from UI to silence an account.
 */

const GRACE_DETACH_MS = 30_000;

const subscribers = new Map<string, number>();
const detachTimers = new Map<string, NodeJS.Timeout>();

/** Call when a WS client subscribes to an account (or "*" + this accountId). */
export async function noteSubscribe(accountId: string): Promise<void> {
    const next = (subscribers.get(accountId) ?? 0) + 1;
    subscribers.set(accountId, next);
    cancelDetach(accountId);

    if (next === 1) {
        // First subscriber → attempt to attach the listener now.
        await tryAttach(accountId);
    }
}

/** Call when a WS client unsubscribes / disconnects. */
export function noteUnsubscribe(accountId: string): void {
    const cur = subscribers.get(accountId) ?? 0;
    if (cur <= 1) {
        subscribers.delete(accountId);
        scheduleDetach(accountId);
    } else {
        subscribers.set(accountId, cur - 1);
    }
}

/** Force-attach (called from `/listener/start` REST endpoint). */
export async function forceAttach(accountId: string): Promise<void> {
    await tryAttach(accountId);
}

/** Force-detach (called from `/listener/stop` REST endpoint). */
export function forceDetach(accountId: string): void {
    cancelDetach(accountId);
    sessions.stopListener(accountId);
}

async function tryAttach(accountId: string): Promise<void> {
    const acc = await getAccountInternal(accountId);
    if (!acc) return;
    if (acc.listenerEnabled !== true) return; // kill switch
    if (acc.status !== "active") return;

    try {
        await sessions.startListener(accountId);
    } catch (err) {
        logger.warn({ err, accountId }, "lazy attach failed");
    }
}

function scheduleDetach(accountId: string): void {
    cancelDetach(accountId);
    const t = setTimeout(() => {
        detachTimers.delete(accountId);
        // Re-check: someone might have re-subscribed during the grace window.
        if ((subscribers.get(accountId) ?? 0) > 0) return;
        sessions.stopListener(accountId);
        logger.debug({ accountId }, "listener detached after grace period");
    }, GRACE_DETACH_MS);
    t.unref?.();
    detachTimers.set(accountId, t);
}

function cancelDetach(accountId: string): void {
    const t = detachTimers.get(accountId);
    if (t) {
        clearTimeout(t);
        detachTimers.delete(accountId);
    }
}

export function subscriberCount(accountId: string): number {
    return subscribers.get(accountId) ?? 0;
}

/** True if any consumer is interested — used by the idle eviction sweep. */
export function isPinned(accountId: string): boolean {
    return (subscribers.get(accountId) ?? 0) > 0;
}
