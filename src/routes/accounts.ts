import { Router } from "express";
import { z } from "zod";
import {
    deleteAccount,
    getAccountById,
    getAccountWithCredentials,
    listAccounts,
    patchAccount,
} from "../db/accounts.js";
import { dropSession, sessions } from "../zalo/manager.js";
import { decodeTokenPayload, loginWithToken } from "../zalo/tokenLogin.js";
import { fail, failFromError, failValidation, ok } from "../http/response.js";
import { logger } from "../logger.js";
import { forceAttach, forceDetach } from "../events/orchestrator.js";
import { refreshWebhookForAccount } from "../events/webhook.js";

export const accountsRouter: Router = Router();

const IdParam = z.object({ id: z.string().uuid() });

accountsRouter.get("/", async (_req, res) => {
    const accounts = await listAccounts();
    ok(res, { accounts });
});

accountsRouter.get("/:id", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const account = await getAccountById(params.data.id);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");
    ok(res, account);
});

/**
 * GET /accounts/:id/credentials — SENSITIVE. Returns decrypted credentials.
 */
accountsRouter.get("/:id/credentials", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const account = await getAccountWithCredentials(params.data.id);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");
    ok(res, account);
});

const PatchBody = z.object({
    phone: z.string().min(1).nullable().optional(),
    displayName: z.string().min(1).nullable().optional(),
    status: z.enum(["active", "disabled"]).optional(),
    listenerEnabled: z.boolean().optional(),
    webhookUrl: z.string().url().nullable().optional(),
    /** Pass `null` or empty string to clear. */
    webhookSecret: z.string().nullable().optional(),
});

accountsRouter.patch("/:id", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const body = PatchBody.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);
    const updated = await patchAccount(params.data.id, body.data);
    if (!updated) return fail(res, "NOT_FOUND", "Account not found");
    // Listener kill switch flipped off — force-detach any live listener.
    if (body.data.listenerEnabled === false) {
        forceDetach(params.data.id);
    }
    // Webhook URL changed — re-evaluate per-account subscription (this also
    // bumps/decrements the orchestrator's consumer count for lazy attach).
    if (body.data.webhookUrl !== undefined) {
        await refreshWebhookForAccount(params.data.id);
    }
    ok(res, updated);
});

/**
 * POST /accounts/:id/listener/start
 *   Set listenerEnabled=true. The actual zca-js listener attaches lazily once
 *   a WebSocket client subscribes — saves resources when nobody is watching.
 *
 * POST /accounts/:id/listener/stop
 *   Set listenerEnabled=false and force-detach any live listener immediately.
 */
accountsRouter.post("/:id/listener/start", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const updated = await patchAccount(params.data.id, { listenerEnabled: true });
    if (!updated) return fail(res, "NOT_FOUND", "Account not found");
    // If a WebSocket subscriber is already waiting for this account, attach now.
    try {
        await forceAttach(params.data.id);
    } catch (err) {
        logger.warn({ err, accountId: params.data.id }, "force-attach after listener/start failed");
    }
    ok(res, updated);
});

accountsRouter.post("/:id/listener/stop", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const updated = await patchAccount(params.data.id, { listenerEnabled: false });
    if (!updated) return fail(res, "NOT_FOUND", "Account not found");
    forceDetach(params.data.id);
    ok(res, updated);
});

/**
 * POST /accounts/:id/refresh-token
 * Replace credentials of an existing account by re-login with a new token.
 *
 * Body: same shape as /auth/token — { token } (base64) or { z_uuid, zpw_sek }.
 * Server verifies the new token logs in successfully, then upserts (matched
 * by uid). The in-memory session is dropped so the next call uses fresh creds.
 *
 * Note: if the new token belongs to a different Zalo uid, this creates a
 * NEW account row instead of updating the one referenced by `:id`.
 */
const RefreshTokenBody = z
    .object({
        token: z.string().min(1).optional(),
        z_uuid: z.string().min(1).optional(),
        zpw_sek: z.string().min(1).optional(),
        userAgent: z.string().min(1).optional(),
        language: z.string().min(1).optional(),
    })
    .refine((b) => !!b.token || (!!b.z_uuid && !!b.zpw_sek), {
        message: "Provide either { token } or both { z_uuid, zpw_sek }",
    });

accountsRouter.post("/:id/refresh-token", async (req, res) => {
    const started = Date.now();
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const body = RefreshTokenBody.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);

    const existing = await getAccountById(params.data.id);
    if (!existing) return fail(res, "NOT_FOUND", "Account not found");

    try {
        const base = body.data.token
            ? decodeTokenPayload(body.data.token)
            : { zUuid: body.data.z_uuid!, zpwSek: body.data.zpw_sek! };
        const refreshed = await loginWithToken({
            ...base,
            userAgent: body.data.userAgent ?? base.userAgent,
            language: body.data.language ?? base.language,
            // Preserve existing display name / phone unless the new login provides them
            phoneOverride: existing.phone,
            displayNameOverride: existing.displayName,
        });
        // Drop the old in-memory session so the next call rebuilds with new creds.
        dropSession(existing.id);
        if (refreshed.id !== existing.id) dropSession(refreshed.id);
        ok(res, refreshed, 200, started);
    } catch (err) {
        logger.warn({ err, accountId: params.data.id }, "refresh-token rejected");
        failFromError(res, err, "LOGIN_FAILED");
    }
});

/**
 * POST /accounts/:id/check
 * Probe the Zalo session by calling fetchAccountInfo(). Returns:
 *   { online: true, profile }                 — session healthy
 *   { online: false, reason: "...", droppedAt } — session dead, dropped from pool
 *
 * Auto-marks account as `disabled` only if you explicitly request via ?autoDisable=1.
 */
accountsRouter.post("/:id/check", async (req, res) => {
    const started = Date.now();
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);

    const account = await getAccountById(params.data.id);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");

    const autoDisable = req.query.autoDisable === "1" || req.query.autoDisable === "true";

    try {
        const api = await sessions.get(account.id);
        const info = (await api.fetchAccountInfo()) as Record<string, unknown> | null;
        const profile =
            info && typeof info === "object" && "profile" in info
                ? (info as { profile: unknown }).profile
                : info;
        ok(
            res,
            {
                online: true,
                accountId: account.id,
                uid: account.uid,
                profile,
            },
            200,
            started,
        );
    } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        dropSession(account.id);
        if (autoDisable) {
            await patchAccount(account.id, { status: "disabled" });
        }
        ok(
            res,
            {
                online: false,
                accountId: account.id,
                uid: account.uid,
                reason,
                droppedAt: Date.now(),
                autoDisabled: autoDisable,
            },
            200,
            started,
        );
    }
});

accountsRouter.delete("/:id", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    forceDetach(params.data.id);
    dropSession(params.data.id);
    await refreshWebhookForAccount(params.data.id); // unbinds since acc gone
    const removed = await deleteAccount(params.data.id);
    if (!removed) return fail(res, "NOT_FOUND", "Account not found");
    ok(res, { id: params.data.id, deleted: true });
});
