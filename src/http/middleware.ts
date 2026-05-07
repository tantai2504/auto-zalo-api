import compression from "compression";
import cors from "cors";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "../config.js";
import { fail } from "./response.js";

/**
 * Security headers. Loosened for Swagger UI which inlines styles + scripts.
 * Tighten if you put a stricter reverse proxy in front.
 */
export const securityHeaders: RequestHandler = helmet({
    contentSecurityPolicy: false, // swagger-ui-express needs inline styles/scripts
    crossOriginEmbedderPolicy: false,
});

export const gzipCompression: RequestHandler = compression();

/**
 * CORS — open `*` if `CORS_ORIGINS=*`, otherwise a comma-separated allowlist.
 * Empty string falls back to same-origin (no CORS headers emitted).
 */
export function corsMiddleware(): RequestHandler {
    const raw = config.CORS_ORIGINS.trim();
    if (!raw) return (_req, _res, next) => next();
    if (raw === "*") return cors({ origin: true, credentials: false });

    const allowlist = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return cors({
        origin(origin, cb) {
            if (!origin) return cb(null, true); // curl / server-to-server
            cb(null, allowlist.includes(origin));
        },
        credentials: true,
    });
}

/**
 * Per-IP rate limit. Returns the unified envelope on 429.
 * Disable by setting `RATE_LIMIT_MAX=0`.
 */
export function makeRateLimiter(): RequestHandler {
    if (config.RATE_LIMIT_MAX === 0) {
        return (_req, _res, next) => next();
    }
    return rateLimit({
        windowMs: config.RATE_LIMIT_WINDOW_SEC * 1000,
        max: config.RATE_LIMIT_MAX,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler(_req, res) {
            fail(res, "RATE_LIMITED", "Rate limit exceeded — try again later");
        },
    });
}
