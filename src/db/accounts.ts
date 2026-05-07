import { randomUUID } from "node:crypto";
import { accountsCollection } from "./index.js";
import { decryptJSON, encryptJSON } from "../crypto/encrypt.js";
import type { StoredCredentials } from "../zalo/types.js";

export interface AccountDoc {
    _id: string;
    uid: string;
    phone: string | null;
    displayName: string | null;
    imei: string;
    userAgent: string;
    language: string;
    /** Encrypted JSON blob containing the full StoredCredentials */
    credentialsEnc: string;
    status: "active" | "disabled";
    lastActiveAt: number | null;
    createdAt: number;
    updatedAt: number;
    // ---- Event listener -----------------------------------------
    /**
     * Master switch for event streaming. When true, the server may attach the
     * zca-js listener and forward events. Listener is attached lazily — only
     * when at least one consumer (WebSocket subscriber OR configured webhook)
     * is interested, and detached after a grace period when none remain.
     */
    listenerEnabled?: boolean;
    /** HTTP endpoint to POST events to. Set/clear via PATCH /accounts/:id. */
    webhookUrl?: string | null;
    /** Optional HMAC secret for signing webhook bodies (X-Signature: sha256=<hex>). */
    webhookSecret?: string | null;
}

export interface AccountPublic {
    id: string;
    uid: string;
    phone: string | null;
    displayName: string | null;
    imei: string;
    userAgent: string;
    language: string;
    status: string;
    lastActiveAt: number | null;
    createdAt: number;
    updatedAt: number;
    listenerEnabled: boolean;
    webhookUrl: string | null;
    /** True if a webhook secret is set — never returns the actual secret. */
    webhookSecretSet: boolean;
}

export interface AccountWithCredentials extends AccountPublic {
    credentials: StoredCredentials;
}

export interface UpsertAccountInput {
    uid: string;
    phone: string | null;
    displayName: string | null;
    imei: string;
    userAgent: string;
    language: string;
    credentials: StoredCredentials;
}

function docToPublic(doc: AccountDoc): AccountPublic {
    return {
        id: doc._id,
        uid: doc.uid,
        phone: doc.phone,
        displayName: doc.displayName,
        imei: doc.imei,
        userAgent: doc.userAgent,
        language: doc.language,
        status: doc.status,
        lastActiveAt: doc.lastActiveAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        listenerEnabled: doc.listenerEnabled === true,
        webhookUrl: doc.webhookUrl ?? null,
        webhookSecretSet:
            typeof doc.webhookSecret === "string" && doc.webhookSecret.length > 0,
    };
}

export async function upsertAccount(input: UpsertAccountInput): Promise<AccountPublic> {
    const col = accountsCollection();
    const now = Date.now();
    const credentialsEnc = encryptJSON(input.credentials);

    const existing = await col.findOne({ uid: input.uid });
    if (existing) {
        await col.updateOne(
            { _id: existing._id },
            {
                $set: {
                    phone: input.phone,
                    displayName: input.displayName,
                    imei: input.imei,
                    userAgent: input.userAgent,
                    language: input.language,
                    credentialsEnc,
                    status: "active",
                    updatedAt: now,
                },
            },
        );
        const updated = await col.findOne({ _id: existing._id });
        return docToPublic(updated!);
    }

    const doc: AccountDoc = {
        _id: randomUUID(),
        uid: input.uid,
        phone: input.phone,
        displayName: input.displayName,
        imei: input.imei,
        userAgent: input.userAgent,
        language: input.language,
        credentialsEnc,
        status: "active",
        lastActiveAt: null,
        createdAt: now,
        updatedAt: now,
    };
    await col.insertOne(doc);
    return docToPublic(doc);
}

export async function listAccounts(): Promise<AccountPublic[]> {
    const docs = await accountsCollection()
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
    return docs.map(docToPublic);
}

export async function getAccountById(id: string): Promise<AccountPublic | null> {
    const doc = await accountsCollection().findOne({ _id: id });
    return doc ? docToPublic(doc) : null;
}

export async function getAccountWithCredentials(
    id: string,
): Promise<AccountWithCredentials | null> {
    const doc = await accountsCollection().findOne({ _id: id });
    if (!doc) return null;
    const credentials = decryptJSON<StoredCredentials>(doc.credentialsEnc);
    return { ...docToPublic(doc), credentials };
}

export async function deleteAccount(id: string): Promise<boolean> {
    const result = await accountsCollection().deleteOne({ _id: id });
    return result.deletedCount > 0;
}

export async function touchAccount(id: string): Promise<void> {
    await accountsCollection().updateOne(
        { _id: id },
        { $set: { lastActiveAt: Date.now() } },
    );
}

export interface PatchAccountInput {
    phone?: string | null;
    displayName?: string | null;
    status?: "active" | "disabled";
    listenerEnabled?: boolean;
    webhookUrl?: string | null;
    /** Pass empty string or null to clear the secret. */
    webhookSecret?: string | null;
}

export async function patchAccount(
    id: string,
    patch: PatchAccountInput,
): Promise<AccountPublic | null> {
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.listenerEnabled !== undefined) set.listenerEnabled = patch.listenerEnabled;
    if (patch.webhookUrl !== undefined) set.webhookUrl = patch.webhookUrl;
    if (patch.webhookSecret !== undefined) {
        set.webhookSecret = patch.webhookSecret === "" ? null : patch.webhookSecret;
    }
    const result = await accountsCollection().findOneAndUpdate(
        { _id: id },
        { $set: set },
        { returnDocument: "after" },
    );
    return result ? docToPublic(result) : null;
}

/**
 * Lookup full account doc INCLUDING the webhookSecret. Used by the webhook
 * dispatcher to sign payloads — do NOT expose this through HTTP.
 */
export async function getAccountInternal(id: string): Promise<AccountDoc | null> {
    return await accountsCollection().findOne({ _id: id });
}

/** Used at boot + when webhook config changes — to (re)bind webhook subs. */
export async function listAccountsWithWebhook(): Promise<AccountDoc[]> {
    return await accountsCollection()
        .find({ webhookUrl: { $exists: true, $nin: [null, ""] } })
        .toArray();
}
