import "dotenv/config";
import { z } from "zod";

const schema = z.object({
    // --- HTTP server -----------------------------------------------------
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("0.0.0.0"),

    // --- MongoDB ---------------------------------------------------------
    MONGO_URI: z.string().default("mongodb://localhost:27017"),
    MONGO_DB: z.string().default("zalo_auto"),

    // --- Crypto ----------------------------------------------------------
    ENCRYPTION_KEY: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex chars (32 bytes)"),

    // --- Logging ---------------------------------------------------------
    LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace"])
        .default("info"),

    // --- Auth ------------------------------------------------------------
    /**
     * Optional API key for programmatic access. Sent as `Authorization: Bearer <key>`
     * or `X-API-Key: <key>`. Independent of admin (cookie) auth — either is enough.
     */
    API_KEY: z.string().min(1).optional(),

    /**
     * Admin auth (UI). If both username + password are set, UI pages and all
     * protected endpoints require either an admin session cookie OR a valid API_KEY.
     * Leave empty to disable auth (open dev mode).
     */
    ADMIN_USERNAME: z.string().min(1).optional(),
    ADMIN_PASSWORD: z.string().min(1).optional(),

    /**
     * HMAC secret for signing the admin session cookie. Required if admin auth is on.
     * Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     */
    SESSION_SECRET: z.string().min(16).optional(),

    /** Admin session cookie lifetime (seconds). Default 7 days. */
    SESSION_TTL_SEC: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),

    // --- CORS ------------------------------------------------------------
    /** Comma-separated origins. `*` allows all. Empty = same-origin only. */
    CORS_ORIGINS: z.string().default(""),

    // --- Rate limit ------------------------------------------------------
    /** Max requests per IP per window. 0 disables. */
    RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(120),
    /** Window size in seconds. */
    RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),

    // --- Background keep-alive ------------------------------------------
    /**
     * Period (seconds) between background `keepAlive()` calls per active
     * session. 0 disables. Recommended: 240 (4 minutes — Zalo's session
     * timeout is around 5).
     */
    KEEPALIVE_INTERVAL_SEC: z.coerce.number().int().nonnegative().default(240),

    /**
     * Drop a pooled session if it hasn't been used (no API call, no event)
     * for this many seconds. The session lazily re-creates on next call.
     * Sessions with an active listener consumer (WebSocket / webhook) are
     * never dropped. 0 disables. Default 6 hours.
     */
    IDLE_EVICT_AFTER_SEC: z.coerce.number().int().nonnegative().default(6 * 60 * 60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
        console.error(` - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
}

export const config = parsed.data;
