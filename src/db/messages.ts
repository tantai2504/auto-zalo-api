import { randomUUID } from "node:crypto";
import { getDb } from "./index.js";
import type { Collection } from "mongodb";

/**
 * Persistent message log — written by the listener whenever a `message` event
 * fires for an account. Lets clients (n8n, scripts, dashboards) query history
 * across server restarts.
 *
 * Why we persist instead of buffering RAM:
 *   - Server restart ≠ lose history
 *   - n8n cron polling pattern needs reliable `since`-based pagination
 *   - Multiple server instances would each have separate buffers; one DB = one source of truth
 *
 * Bounded by a 30-day TTL index so the collection can't grow forever.
 */

export interface MessageDoc {
    _id: string;
    accountId: string;     // our internal account UUID
    uid: string;           // owner Zalo uid (denormalized)

    // Conversation identifiers
    threadType: 0 | 1;     // 0 = chat 1-1 với user, 1 = group
    threadId: string;      // userId (type=0) or groupId (type=1)
    fromUid: string;       // who sent it (could be self or other)

    // Message body
    msgId: string;
    cliMsgId: string;
    msgType: string;       // chat.text, chat.sticker, chat.photo, ...
    content: unknown;      // text or rich content object

    ts: number;            // Zalo timestamp (ms) — primary sort key
    receivedAt: Date;      // when our server stored it (Date so MongoDB TTL works)
}

export interface MessagePublic {
    id: string;
    accountId: string;
    threadType: 0 | 1;
    threadId: string;
    fromUid: string;
    msgId: string;
    cliMsgId: string;
    msgType: string;
    content: unknown;
    ts: number;
    receivedAt: number;
}

export const MESSAGE_TTL_DAYS = 30;

function collection(): Collection<MessageDoc> {
    return getDb().collection<MessageDoc>("messages");
}

function docToPublic(d: MessageDoc): MessagePublic {
    return {
        id: d._id,
        accountId: d.accountId,
        threadType: d.threadType,
        threadId: d.threadId,
        fromUid: d.fromUid,
        msgId: d.msgId,
        cliMsgId: d.cliMsgId,
        msgType: d.msgType,
        content: d.content,
        ts: d.ts,
        receivedAt: d.receivedAt.getTime(),
    };
}

export interface SaveMessageInput {
    accountId: string;
    uid: string;
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
 * Insert a message. Idempotent on (accountId, msgId) — duplicate webhook
 * deliveries / listener replays don't double-write.
 */
export async function saveMessage(input: SaveMessageInput): Promise<void> {
    if (!input.msgId) return;
    const doc: MessageDoc = {
        _id: randomUUID(),
        ...input,
        receivedAt: new Date(),
    };
    try {
        await collection().updateOne(
            { accountId: input.accountId, msgId: input.msgId },
            { $setOnInsert: doc },
            { upsert: true },
        );
    } catch {
        // Best-effort. Don't let a write failure crash the listener.
    }
}

export interface QueryMessagesInput {
    accountId: string;
    /** Filter by threadId (userId for 1-1, groupId for group). */
    threadId?: string;
    /** Filter by thread type. 0 = user 1-1, 1 = group. */
    threadType?: 0 | 1;
    /** Default 20, max 200. */
    limit?: number;
    /** Pagination: only return msgs with ts > since (newer than this, ms). */
    since?: number;
    /** Pagination: only return msgs with ts < before (older than this, ms). */
    before?: number;
    /** Sort order: "desc" newest-first (default), "asc" for incremental pulls. */
    order?: "asc" | "desc";
}

export async function queryMessages(input: QueryMessagesInput): Promise<MessagePublic[]> {
    const limit = Math.min(Math.max(1, input.limit ?? 20), 200);
    const filter: Record<string, unknown> = { accountId: input.accountId };
    if (input.threadId) filter.threadId = input.threadId;
    if (input.threadType !== undefined) filter.threadType = input.threadType;
    if (input.since !== undefined || input.before !== undefined) {
        const range: Record<string, number> = {};
        if (input.since !== undefined) range.$gt = input.since;
        if (input.before !== undefined) range.$lt = input.before;
        filter.ts = range;
    }
    const sortDir = input.order === "asc" ? 1 : -1;
    const docs = await collection()
        .find(filter as never)
        .sort({ ts: sortDir })
        .limit(limit)
        .toArray();
    return docs.map(docToPublic);
}
