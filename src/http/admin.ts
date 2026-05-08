import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { fail } from "./response.js";
import { validateDbApiKey } from "./apiKeyAuth.js";
import { looksLikeSessionToken, verifySessionToken } from "./sessionToken.js";
import type { ApiKeyDoc } from "../db/apiKeys.js";

/**
 * Lightweight admin session built on a signed cookie — no DB, no extra deps.
 *
 * Cookie value: `<base64url(payload)>.<base64url(sig)>`
 *   payload  = { user, exp } as JSON
 *   sig      = HMAC-SHA256(payload, SESSION_SECRET)
 *
 * If `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` are all set, admin
 * auth is enabled. Otherwise the system runs in open mode (dev).
 */

const COOKIE_NAME = "zauth";

export function isAdminAuthEnabled(): boolean {
    return !!(config.ADMIN_USERNAME && config.ADMIN_PASSWORD && config.SESSION_SECRET);
}

interface SessionPayload {
    user: string;
    exp: number; // unix seconds
}

function b64urlEncode(buf: Buffer): string {
    return buf.toString("base64url");
}

function sign(payload: string, secret: string): string {
    return b64urlEncode(createHmac("sha256", secret).update(payload).digest());
}

function buildToken(user: string, ttlSec: number, secret: string): string {
    const payload: SessionPayload = {
        user,
        exp: Math.floor(Date.now() / 1000) + ttlSec,
    };
    const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
    const sig = sign(payloadB64, secret);
    return `${payloadB64}.${sig}`;
}

function verifyToken(token: string, secret: string): SessionPayload | null {
    const dot = token.indexOf(".");
    if (dot < 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = sign(payloadB64, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
        if (!payload.user || typeof payload.exp !== "number") return null;
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch {
        return null;
    }
}

function constantTimeStringEq(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
}

/** True if request carries a valid admin session cookie. */
export function hasAdminSession(req: Request): SessionPayload | null {
    if (!isAdminAuthEnabled()) return null;
    const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
    if (!token) return null;
    return verifyToken(token, config.SESSION_SECRET!);
}

/** Pull a bearer/api-key string out of the request headers. Returns "" if none. */
export function extractApiKey(req: Request): string {
    const headerAuth = req.header("authorization") ?? "";
    const headerKey = req.header("x-api-key") ?? "";
    const bearer = headerAuth.startsWith("Bearer ")
        ? headerAuth.slice("Bearer ".length).trim()
        : "";
    return bearer || headerKey;
}

/** True if the request carries a valid env-level master API_KEY. */
export function hasMasterApiKey(req: Request): boolean {
    const expected = config.API_KEY;
    if (!expected) return false;
    const raw = extractApiKey(req);
    if (!raw) return false;
    return constantTimeStringEq(raw, expected);
}

/**
 * Validate a request's API key/session-token against:
 *   1. Session token   — HMAC verify, no DB (fast path, ~0.1ms)
 *   2. Env master key  — constant-time string compare
 *   3. DB-stored key   — SHA-256 lookup, cached 60s
 *
 * Returns a marker object describing the source, or null if no valid auth.
 */
export async function validateRequestApiKey(
    req: Request,
): Promise<
    | { source: "session"; sub: string }
    | { source: "env" }
    | { source: "db"; keyDoc: ApiKeyDoc }
    | null
> {
    const raw = extractApiKey(req);
    if (!raw) return null;
    // 1. Session token first — cheapest check, no DB.
    if (looksLikeSessionToken(raw)) {
        const payload = verifySessionToken(raw);
        if (payload) return { source: "session", sub: payload.sub };
        // Falls through — maybe it's still a base64-ish API key without zk_ prefix.
    }
    // 2. Env master key.
    if (config.API_KEY && constantTimeStringEq(raw, config.API_KEY)) {
        return { source: "env" };
    }
    // 3. DB-stored API key.
    const keyDoc = await validateDbApiKey(raw);
    if (keyDoc) return { source: "db", keyDoc };
    return null;
}

/** Backwards-compat sync helper used by the WebSocket upgrade path. */
export function hasValidApiKey(req: Request): boolean {
    return hasMasterApiKey(req);
}

/**
 * Auth middleware accepted by every protected route.
 * Allows the request through if ANY of these are valid:
 *   1. Admin session cookie (set by /admin/login)
 *   2. Env master API_KEY (Bearer or X-API-Key header)
 *   3. Active DB-stored API key (Bearer or X-API-Key) — has expiry + revoke
 *
 * If neither admin auth NOR env API_KEY are configured, the system is open
 * (dev mode). DB keys alone don't activate auth — the admin must set up
 * either env-key bootstrap or admin login first.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
    const adminEnabled = isAdminAuthEnabled();
    const envKeyEnabled = !!config.API_KEY;
    if (!adminEnabled && !envKeyEnabled) return next();

    if (adminEnabled && hasAdminSession(req)) return next();

    const apiAuth = await validateRequestApiKey(req);
    if (apiAuth) {
        // Stash on req for downstream handlers (audit logging, etc.)
        (req as Request & { apiAuth?: typeof apiAuth }).apiAuth = apiAuth;
        return next();
    }

    fail(res, "UNAUTHORIZED", "Authentication required");
};

/** Stricter middleware: admin cookie ONLY (used for managing API keys themselves). */
export const requireAdminCookie: RequestHandler = (req, res, next) => {
    if (!isAdminAuthEnabled()) {
        // If admin is unconfigured, only the env master API_KEY can manage keys
        // — otherwise anyone could bootstrap themselves into the system.
        if (hasMasterApiKey(req)) return next();
        return fail(res, "UNAUTHORIZED", "Admin auth is not configured");
    }
    if (hasAdminSession(req)) return next();
    fail(res, "UNAUTHORIZED", "Admin cookie required");
};

/** Login: validate creds, set HTTP-only signed cookie. */
export function loginAdmin(req: Request, res: Response, body: { username?: string; password?: string }): void {
    if (!isAdminAuthEnabled()) {
        fail(res, "VALIDATION_ERROR", "Admin auth is not configured on this server");
        return;
    }
    const u = (body.username ?? "").trim();
    const p = body.password ?? "";
    if (
        u &&
        p &&
        constantTimeStringEq(u, config.ADMIN_USERNAME!) &&
        constantTimeStringEq(p, config.ADMIN_PASSWORD!)
    ) {
        const token = buildToken(u, config.SESSION_TTL_SEC, config.SESSION_SECRET!);
        const secure = req.secure || req.header("x-forwarded-proto") === "https";
        res.cookie(COOKIE_NAME, token, {
            httpOnly: true,
            secure,
            sameSite: "lax",
            maxAge: config.SESSION_TTL_SEC * 1000,
            path: "/",
        });
        res.json({
            ok: true,
            data: { user: u, expiresAt: Date.now() + config.SESSION_TTL_SEC * 1000 },
            meta: { ts: Date.now() },
        });
        return;
    }
    fail(res, "UNAUTHORIZED", "Sai username hoặc password");
}

/** Logout: clear cookie. */
export function logoutAdmin(_req: Request, res: Response): void {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ ok: true, data: { loggedOut: true }, meta: { ts: Date.now() } });
}

/** Whoami: returns current admin or null. */
export function meAdmin(req: Request, res: Response): void {
    if (!isAdminAuthEnabled()) {
        res.json({
            ok: true,
            data: { authEnabled: false, user: null },
            meta: { ts: Date.now() },
        });
        return;
    }
    const session = hasAdminSession(req);
    if (!session) {
        return void fail(res, "UNAUTHORIZED", "Not logged in");
    }
    res.json({
        ok: true,
        data: { authEnabled: true, user: session.user, expiresAt: session.exp * 1000 },
        meta: { ts: Date.now() },
    });
}
