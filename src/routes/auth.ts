import { Router } from "express";
import { z } from "zod";
import { createQrSession, getQrSession } from "../db/qrSessions.js";
import { runQrLogin } from "../zalo/qrLogin.js";
import { decodeTokenPayload, loginWithToken } from "../zalo/tokenLogin.js";
import { logger } from "../logger.js";
import { fail, failFromError, failValidation, ok } from "../http/response.js";

export const authRouter: Router = Router();

/** POST /auth/qr — start a new QR login session, return its id immediately. */
authRouter.post("/qr", async (_req, res) => {
    const session = await createQrSession();
    runQrLogin(session.id).catch((err) => {
        logger.error({ err, qrSessionId: session.id }, "runQrLogin crashed");
    });
    ok(res, { id: session.id, status: session.status }, 201);
});

const ParamsSchema = z.object({ id: z.string().uuid() });

/** GET /auth/qr/:id — poll status. */
authRouter.get("/qr/:id", async (req, res) => {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const session = await getQrSession(params.data.id);
    if (!session) return fail(res, "NOT_FOUND", "QR session not found");
    ok(res, session);
});

const TokenBodySchema = z
    .object({
        token: z.string().min(1).optional(),
        z_uuid: z.string().min(1).optional(),
        zpw_sek: z.string().min(1).optional(),
        userAgent: z.string().min(1).optional(),
        language: z.string().min(1).optional(),
        phone: z.string().min(1).nullable().optional(),
        displayName: z.string().min(1).nullable().optional(),
    })
    .refine((b) => !!b.token || (!!b.z_uuid && !!b.zpw_sek), {
        message: "Provide either { token } or both { z_uuid, zpw_sek }",
    });

/**
 * POST /auth/token — log in with pre-extracted token.
 * Body: { token } (base64) or { z_uuid, zpw_sek } + optional { phone, displayName, userAgent, language }.
 */
authRouter.post("/token", async (req, res) => {
    const started = Date.now();
    const body = TokenBodySchema.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);
    try {
        const base = body.data.token
            ? decodeTokenPayload(body.data.token)
            : { zUuid: body.data.z_uuid!, zpwSek: body.data.zpw_sek! };
        const account = await loginWithToken({
            ...base,
            userAgent: body.data.userAgent ?? base.userAgent,
            language: body.data.language ?? base.language,
            phoneOverride: body.data.phone ?? null,
            displayNameOverride: body.data.displayName ?? null,
        });
        ok(res, account, 201, started);
    } catch (err) {
        logger.warn({ err }, "token login rejected");
        failFromError(res, err, "LOGIN_FAILED");
    }
});
