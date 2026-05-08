import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { AccountDoc } from "./accounts.js";
import type { QrSessionDoc } from "./qrSessions.js";

const client = new MongoClient(config.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
});

let dbInstance: Db | null = null;

export async function connectDb(): Promise<Db> {
    if (dbInstance) return dbInstance;
    await client.connect();
    dbInstance = client.db(config.MONGO_DB);
    await ensureIndexes(dbInstance);
    logger.info({ db: config.MONGO_DB }, "mongo connected");
    return dbInstance;
}

export function getDb(): Db {
    if (!dbInstance) {
        throw new Error("Mongo not connected — call connectDb() before route handlers");
    }
    return dbInstance;
}

export function accountsCollection(): Collection<AccountDoc> {
    return getDb().collection<AccountDoc>("accounts");
}

export function qrSessionsCollection(): Collection<QrSessionDoc> {
    return getDb().collection<QrSessionDoc>("qr_sessions");
}

async function ensureIndexes(db: Db): Promise<void> {
    await db.collection("accounts").createIndexes([
        { key: { uid: 1 }, unique: true },
        { key: { phone: 1 } },
        { key: { status: 1 } },
    ]);
    await db.collection("qr_sessions").createIndexes([
        { key: { status: 1 } },
        { key: { createdAt: 1 } },
    ]);
    await db.collection("api_keys").createIndexes([
        { key: { keyHash: 1 }, unique: true },
        { key: { createdAt: -1 } },
        { key: { revokedAt: 1 } },
    ]);
    await db.collection("messages").createIndexes([
        { key: { accountId: 1, msgId: 1 }, unique: true },
        { key: { accountId: 1, threadId: 1, ts: -1 } },
        { key: { accountId: 1, ts: -1 } },
        // TTL — auto-delete after 30 days so the collection stays bounded.
        { key: { receivedAt: 1 }, expireAfterSeconds: 30 * 86400 },
    ]);
}

/**
 * Background sweep: delete qr_sessions older than 1 hour.
 * QR codes expire in ~2 minutes; rows after that are dead. Without cleanup the
 * collection grows indefinitely and slows queries.
 */
const QR_SESSION_TTL_MS = 60 * 60 * 1000;
let qrCleanupTimer: NodeJS.Timeout | null = null;

export function startQrCleanupLoop(): void {
    if (qrCleanupTimer) return;
    const sweep = async () => {
        try {
            const cutoff = Date.now() - QR_SESSION_TTL_MS;
            const r = await getDb().collection("qr_sessions").deleteMany({
                createdAt: { $lt: cutoff },
            });
            if (r.deletedCount > 0) {
                logger.debug({ deleted: r.deletedCount }, "qr_sessions cleaned");
            }
        } catch (err) {
            logger.warn({ err }, "qr_sessions cleanup failed");
        }
    };
    // Run once at start, then every 10 minutes.
    void sweep();
    qrCleanupTimer = setInterval(sweep, 10 * 60 * 1000);
    qrCleanupTimer.unref?.();
}

export function stopQrCleanupLoop(): void {
    if (qrCleanupTimer) {
        clearInterval(qrCleanupTimer);
        qrCleanupTimer = null;
    }
}

export async function closeDb(): Promise<void> {
    await client.close();
    dbInstance = null;
}

export async function pingDb(): Promise<boolean> {
    try {
        if (!dbInstance) return false;
        await dbInstance.command({ ping: 1 });
        return true;
    } catch {
        return false;
    }
}
