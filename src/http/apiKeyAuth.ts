import {
    findByHash,
    hashKey,
    touchLastUsed,
    type ApiKeyDoc,
} from "../db/apiKeys.js";

/**
 * In-process cache for API key lookups so we don't hammer MongoDB on every
 * request. Cache is keyed by `keyHash` (not the raw key) and has a short TTL
 * — invalidation on revoke is best-effort, the TTL guarantees expiry within
 * a minute even if invalidation is missed.
 */

interface CacheEntry {
    doc: ApiKeyDoc | null;
    cachedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/** Look up a raw key against DB (cached). Returns the doc or null if not found. */
async function lookupByRaw(rawKey: string): Promise<ApiKeyDoc | null> {
    const keyHash = hashKey(rawKey);
    const cached = cache.get(keyHash);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.doc;
    }
    const doc = await findByHash(keyHash);
    cache.set(keyHash, { doc, cachedAt: Date.now() });
    return doc;
}

/**
 * Validate a raw key. Returns the matching ApiKeyDoc if it's active
 * (not revoked and not expired), null otherwise.
 */
export async function validateDbApiKey(rawKey: string): Promise<ApiKeyDoc | null> {
    const doc = await lookupByRaw(rawKey);
    if (!doc) return null;
    if (doc.revokedAt) return null;
    if (doc.expiresAt && Date.now() > doc.expiresAt) return null;
    // Fire-and-forget last-used update so subsequent requests can show "recent activity".
    void touchLastUsed(doc._id);
    return doc;
}

/** Drop a single entry from the cache (called when admin revokes a key). */
export function invalidateApiKeyCache(keyHash: string): void {
    cache.delete(keyHash);
}

/** Drop the entire cache (used on shutdown / tests). */
export function clearApiKeyCache(): void {
    cache.clear();
}
