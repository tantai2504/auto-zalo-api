import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * Short-lived session tokens — issued by `POST /auth/session` after a successful
 * API-key auth, and used in subsequent requests INSTEAD of the API key.
 *
 * Why: validating an API key requires a SHA-256 hash + MongoDB lookup (cached
 * for 60s). A session token is just an HMAC-SHA256 verification — no DB, no
 * cache, ~0.1ms per request. For programmatic clients making many calls in a
 * short window this is 10–100× faster while keeping the same security model
 * (signed by SESSION_SECRET, can't be forged).
 *
 * Format: `<base64url(payload)>.<base64url(sig)>`
 *   payload  = JSON `{ sub: <keyId>, exp: <unix sec>, type: "api-session" }`
 *   sig      = HMAC-SHA256(payload, SESSION_SECRET)
 *
 * Revocation: tokens are stateless and signed once issued — they're valid
 * until `exp`. If you need to revoke an API key immediately, also rotate
 * SESSION_SECRET to invalidate every issued token at once.
 *
 * Default TTL is 15 minutes — short enough that revocation lag is acceptable,
 * long enough to amortise the exchange cost over many requests.
 */

const TYPE = "api-session";
const DEFAULT_TTL_SEC = 15 * 60;

interface SessionPayload {
    sub: string;     // ID of the originating API key (or "env-master")
    exp: number;     // unix seconds
    type: typeof TYPE;
}

function b64url(buf: Buffer): string {
    return buf.toString("base64url");
}

function sign(payload: string, secret: string): string {
    return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function isSessionTokenEnabled(): boolean {
    return !!config.SESSION_SECRET;
}

/** Issue a fresh session token. Returns null if SESSION_SECRET is not configured. */
export function issueSessionToken(keyId: string, ttlSec = DEFAULT_TTL_SEC): {
    token: string;
    expiresAt: number;
} | null {
    if (!config.SESSION_SECRET) return null;
    const payload: SessionPayload = {
        sub: keyId,
        exp: Math.floor(Date.now() / 1000) + ttlSec,
        type: TYPE,
    };
    const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = sign(payloadB64, config.SESSION_SECRET);
    return {
        token: `${payloadB64}.${sig}`,
        expiresAt: payload.exp * 1000,
    };
}

/** Verify a session token. Returns the payload if valid, null otherwise. */
export function verifySessionToken(token: string): SessionPayload | null {
    if (!config.SESSION_SECRET) return null;
    const dot = token.indexOf(".");
    if (dot < 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = sign(payloadB64, config.SESSION_SECRET);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(
            Buffer.from(payloadB64, "base64url").toString("utf8"),
        ) as SessionPayload;
        if (payload.type !== TYPE) return null;
        if (typeof payload.exp !== "number") return null;
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        if (typeof payload.sub !== "string") return null;
        return payload;
    } catch {
        return null;
    }
}

/**
 * Quick discriminator. We don't want to mistake a `zk_…` API key for a session
 * token (or vice versa) — the token has a single dot and base64url charset.
 */
export function looksLikeSessionToken(s: string): boolean {
    if (!s) return false;
    if (s.startsWith("zk_")) return false; // API keys are zk-prefixed
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
}
