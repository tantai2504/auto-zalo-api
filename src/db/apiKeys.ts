import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./index.js";
import type { Collection } from "mongodb";

/**
 * API key storage.
 *
 * The plaintext key is shown ONCE at creation and never persisted.
 * We store SHA-256(`key`) and look up by hash on every request. The hash is
 * cheap and collision-resistant for this purpose; we never need to recover
 * the original key — if a user loses it they create a new one.
 *
 * Revocation = soft delete (set `revokedAt`). Eviction by `expiresAt` is
 * checked at validation time, not by a sweep, so even if the row stays the
 * key stops working at the right moment.
 */

export interface ApiKeyDoc {
    _id: string;
    name: string;
    keyHash: string;          // SHA-256 hex of the plaintext
    keyPreview: string;       // shown in UI (first 8 + last 4 chars)
    expiresAt: number | null; // epoch ms; null = never expires
    createdAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
    createdBy: string;        // admin username
}

export interface ApiKeyPublic {
    id: string;
    name: string;
    keyPreview: string;
    expiresAt: number | null;
    createdAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
    createdBy: string;
    /** Computed: "active" | "expired" | "revoked" */
    status: "active" | "expired" | "revoked";
}

function statusOf(doc: ApiKeyDoc): ApiKeyPublic["status"] {
    if (doc.revokedAt) return "revoked";
    if (doc.expiresAt && Date.now() > doc.expiresAt) return "expired";
    return "active";
}

function docToPublic(doc: ApiKeyDoc): ApiKeyPublic {
    return {
        id: doc._id,
        name: doc.name,
        keyPreview: doc.keyPreview,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
        lastUsedAt: doc.lastUsedAt,
        revokedAt: doc.revokedAt,
        createdBy: doc.createdBy,
        status: statusOf(doc),
    };
}

function collection(): Collection<ApiKeyDoc> {
    return getDb().collection<ApiKeyDoc>("api_keys");
}

/** Generate a random key with a `zk_` prefix so it's recognisable in logs/code. */
function generateRawKey(): string {
    return "zk_" + randomBytes(24).toString("base64url");
}

/** SHA-256 hex of the raw key — what we actually store and look up. */
export function hashKey(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
}

function previewOf(raw: string): string {
    return raw.slice(0, 8) + "…" + raw.slice(-4);
}

export interface CreateApiKeyInput {
    name: string;
    /** Lifetime in seconds. null/undefined = never expires. */
    expiresInSec?: number | null;
    createdBy: string;
}

export interface CreateApiKeyResult {
    /** Public metadata (safe to display). */
    apiKey: ApiKeyPublic;
    /** PLAINTEXT key — shown only this once, never stored. */
    plainKey: string;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const id = randomUUID();
    const plainKey = generateRawKey();
    const now = Date.now();
    const expiresAt =
        input.expiresInSec && input.expiresInSec > 0
            ? now + input.expiresInSec * 1000
            : null;

    const doc: ApiKeyDoc = {
        _id: id,
        name: input.name.trim(),
        keyHash: hashKey(plainKey),
        keyPreview: previewOf(plainKey),
        expiresAt,
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
        createdBy: input.createdBy,
    };
    await collection().insertOne(doc);
    return { apiKey: docToPublic(doc), plainKey };
}

export async function listApiKeys(): Promise<ApiKeyPublic[]> {
    const docs = await collection().find({}).sort({ createdAt: -1 }).toArray();
    return docs.map(docToPublic);
}

export async function getApiKey(id: string): Promise<ApiKeyPublic | null> {
    const doc = await collection().findOne({ _id: id });
    return doc ? docToPublic(doc) : null;
}

export async function findByHash(keyHash: string): Promise<ApiKeyDoc | null> {
    return collection().findOne({ keyHash });
}

/** Mark revoked. Returns true if a document was actually changed. */
export async function revokeApiKey(id: string): Promise<{ revoked: boolean; keyHash?: string }> {
    const doc = await collection().findOne({ _id: id });
    if (!doc) return { revoked: false };
    if (doc.revokedAt) return { revoked: false, keyHash: doc.keyHash };
    await collection().updateOne(
        { _id: id },
        { $set: { revokedAt: Date.now() } },
    );
    return { revoked: true, keyHash: doc.keyHash };
}

export interface PatchApiKeyInput {
    name?: string;
    /** Set to null to make the key never expire. Set to number = absolute epoch ms. */
    expiresAt?: number | null;
}

export async function patchApiKey(
    id: string,
    patch: PatchApiKeyInput,
): Promise<ApiKeyPublic | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
    if (Object.keys(set).length === 0) return getApiKey(id);
    const result = await collection().findOneAndUpdate(
        { _id: id },
        { $set: set },
        { returnDocument: "after" },
    );
    return result ? docToPublic(result) : null;
}

/** Update lastUsedAt (fire-and-forget; never fails the request). */
export async function touchLastUsed(id: string): Promise<void> {
    try {
        await collection().updateOne(
            { _id: id },
            { $set: { lastUsedAt: Date.now() } },
        );
    } catch {
        // ignore — touching last-used is not critical
    }
}

export async function ensureApiKeyIndexes(): Promise<void> {
    await collection().createIndexes([
        { key: { keyHash: 1 }, unique: true },
        { key: { createdAt: -1 } },
        { key: { revokedAt: 1 } },
    ]);
}
