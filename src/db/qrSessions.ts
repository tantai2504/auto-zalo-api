import { randomUUID } from "node:crypto";
import { qrSessionsCollection } from "./index.js";

export type QrStatus = "pending" | "scanned" | "success" | "failed" | "expired";

export interface QrSessionDoc {
    _id: string;
    status: QrStatus;
    qrDataUrl: string | null;
    accountId: string | null;
    error: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface QrSession {
    id: string;
    status: QrStatus;
    qrDataUrl: string | null;
    accountId: string | null;
    error: string | null;
    createdAt: number;
    updatedAt: number;
}

function docToSession(doc: QrSessionDoc): QrSession {
    return {
        id: doc._id,
        status: doc.status,
        qrDataUrl: doc.qrDataUrl,
        accountId: doc.accountId,
        error: doc.error,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export async function createQrSession(): Promise<QrSession> {
    const now = Date.now();
    const doc: QrSessionDoc = {
        _id: randomUUID(),
        status: "pending",
        qrDataUrl: null,
        accountId: null,
        error: null,
        createdAt: now,
        updatedAt: now,
    };
    await qrSessionsCollection().insertOne(doc);
    return docToSession(doc);
}

export async function getQrSession(id: string): Promise<QrSession | null> {
    const doc = await qrSessionsCollection().findOne({ _id: id });
    return doc ? docToSession(doc) : null;
}

export async function updateQrSession(
    id: string,
    patch: Partial<Pick<QrSession, "status" | "qrDataUrl" | "accountId" | "error">>,
): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.qrDataUrl !== undefined) set.qrDataUrl = patch.qrDataUrl;
    if (patch.accountId !== undefined) set.accountId = patch.accountId;
    if (patch.error !== undefined) set.error = patch.error;
    await qrSessionsCollection().updateOne({ _id: id }, { $set: set });
}
