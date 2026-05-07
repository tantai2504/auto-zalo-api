import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { fail } from "./response.js";

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

/** True if request carries a valid API_KEY (Bearer or X-API-Key). */
export function hasValidApiKey(req: Request): boolean {
    const expected = config.API_KEY;
    if (!expected) return false;
    const headerAuth = req.header("authorization") ?? "";
    const headerKey = req.header("x-api-key") ?? "";
    const bearer = headerAuth.startsWith("Bearer ")
        ? headerAuth.slice("Bearer ".length).trim()
        : "";
    return (
        (!!bearer && constantTimeStringEq(bearer, expected)) ||
        (!!headerKey && constantTimeStringEq(headerKey, expected))
    );
}

/**
 * Auth middleware accepted by every protected route.
 * Allows the request through if EITHER admin cookie OR API_KEY is valid.
 * If neither admin auth nor API_KEY are configured, the system is open (dev).
 */
export const requireAuth: RequestHandler = (req, res, next) => {
    const adminEnabled = isAdminAuthEnabled();
    const apiKeyEnabled = !!config.API_KEY;
    if (!adminEnabled && !apiKeyEnabled) return next();

    if (adminEnabled && hasAdminSession(req)) return next();
    if (apiKeyEnabled && hasValidApiKey(req)) return next();

    fail(res, "UNAUTHORIZED", "Authentication required");
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
