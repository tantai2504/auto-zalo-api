import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { connectDb, closeDb, pingDb, startQrCleanupLoop, stopQrCleanupLoop } from "./db/index.js";
import { authRouter } from "./routes/auth.js";
import { accountsRouter } from "./routes/accounts.js";
import { apiRouter } from "./routes/api.js";
import { methodsRouter } from "./routes/methods.js";
import { adminRouter } from "./routes/admin.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { fail, ok as okEnvelope } from "./http/response.js";
import {
    corsMiddleware,
    gzipCompression,
    makeRateLimiter,
    securityHeaders,
} from "./http/middleware.js";
import { isAdminAuthEnabled, requireAuth } from "./http/admin.js";
import {
    sessions,
    startKeepAliveLoop,
    stopKeepAliveLoop,
    startIdleEvictionLoop,
    stopIdleEvictionLoop,
} from "./zalo/manager.js";
import { attachWebSocketServer } from "./events/ws.js";
import { startWebhookDispatcher } from "./events/webhook.js";
import { isPinned } from "./events/orchestrator.js";

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

// Catch unhandled async errors so a single bad promise doesn't tear down the
// process. We log + keep going; if the process is in a truly broken state, the
// orchestrator (PM2 / systemd / cPanel Phusion) will restart it.
process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandledRejection (recovered)");
});
process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException (recovered)");
});

async function main(): Promise<void> {
    await connectDb();

    const app = express();

    // Trust the first proxy (nginx, cPanel Phusion Passenger, ...) so that
    // req.ip reflects the real client and rate-limit / logs are accurate.
    app.set("trust proxy", 1);
    app.disable("x-powered-by");

    app.use(securityHeaders);
    app.use(gzipCompression);
    app.use(corsMiddleware());
    app.use(cookieParser());
    app.use(express.json({ limit: "10mb" }));
    app.use(pinoHttp({ logger }));

    // ----- Public endpoints (no auth required) -----------------------
    app.get("/health", async (_req, res) => {
        const dbUp = await pingDb();
        const data = {
            service: "zalo-auto",
            uptime: process.uptime(),
            sessions: sessions.poolSize(),
            db: dbUp ? "up" : "down",
        };
        if (!dbUp) {
            return fail(res, "INTERNAL_ERROR", "MongoDB unreachable");
        }
        okEnvelope(res, data);
    });

    // Runtime config for the UI (lets static pages know the API_PREFIX).
    // Cached briefly — server restart picks up new env anyway.
    app.get("/config.js", cacheControl(60), (_req, res) => {
        res.type("application/javascript");
        res.send(
            `window.ZALO_AUTO = ${JSON.stringify({ apiPrefix: config.API_PREFIX })};`,
        );
    });

    // ----- Admin auth (login/logout/me) — public for login itself ----
    // Admin stays at root (/admin/login) so the UI doesn't have to know the
    // API prefix to authenticate.
    app.use("/admin", makeRateLimiter(), adminRouter);
    // API key management (admin-cookie protected internally).
    app.use("/admin/api-keys", makeRateLimiter(), apiKeysRouter);

    // ----- Routes -----
    // All data endpoints mount under config.API_PREFIX (default "" = root).
    // Set API_PREFIX="/api/v1" in env to version everything.
    //
    // Auth model:
    //   - Management endpoints (/auth, /accounts, /methods) → admin cookie required.
    //     Used by the dashboard UI to add/list/edit accounts.
    //   - Data endpoints (/api/{accountId}/*, /quick/{accountId}/*) → OPEN.
    //     The accountId UUID itself is the credential — anyone who knows it
    //     can call methods on that account. Keep the UUID secret.
    //
    // Both groups still go through the rate limiter to mitigate brute-force
    // and abuse. If you need stricter protection, put the whole service behind
    // a reverse proxy with IP allowlist or basic auth.
    const P = config.API_PREFIX;
    const guarded = [makeRateLimiter(), requireAuth];
    app.use(`${P}/methods`, cacheControl(300), ...guarded, methodsRouter);
    app.use(`${P}/auth`, ...guarded, authRouter);
    app.use(`${P}/accounts`, ...guarded, accountsRouter);

    // Data endpoints — only rate-limited, no auth. accountId in URL = credential.
    const open = [makeRateLimiter()];
    app.use(`${P}/api`, ...open, apiRouter);

    // ----- Static UI --------------------------------------------------
    app.use(express.static(PUBLIC_DIR, { index: "index.html" }));

    // ----- 404 (after static so /assets/* isn't shadowed) ------------
    app.use((_req, res) => {
        fail(res, "NOT_FOUND", "Route not found");
    });

    // ----- Final error handler ----------------------------------------
    app.use(
        (
            err: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction,
        ) => {
            logger.error({ err }, "unhandled request error");
            const message = err instanceof Error ? err.message : "Internal error";
            fail(res, "INTERNAL_ERROR", message);
        },
    );

    const server = app.listen(config.PORT, config.HOST, () => {
        logger.info(
            {
                host: config.HOST,
                port: config.PORT,
                adminAuth: isAdminAuthEnabled(),
                apiKey: !!config.API_KEY,
                apiPrefix: config.API_PREFIX || "(root)",
                rateLimit: config.RATE_LIMIT_MAX || "off",
                keepAliveSec: config.KEEPALIVE_INTERVAL_SEC || "off",
            },
            `zalo-auto listening on http://${config.HOST}:${config.PORT}`,
        );
    });

    // Realtime fanout — listener attaches lazily when a consumer arrives
    // (WebSocket subscribe OR a configured webhook URL).
    attachWebSocketServer(server);
    void startWebhookDispatcher();
    startKeepAliveLoop();
    startIdleEvictionLoop(isPinned);
    startQrCleanupLoop();

    const shutdown = async (signal: string) => {
        logger.info({ signal }, "shutting down");
        stopKeepAliveLoop();
        stopIdleEvictionLoop();
        stopQrCleanupLoop();
        server.close();
        await closeDb();
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/** Cache-Control middleware factory. Sets `public, max-age=<seconds>`. */
function cacheControl(seconds: number): express.RequestHandler {
    const value = `public, max-age=${seconds}`;
    return (_req, res, next) => {
        res.setHeader("Cache-Control", value);
        next();
    };
}


main().catch((err) => {
    logger.error({ err }, "fatal startup error");
    process.exit(1);
});
