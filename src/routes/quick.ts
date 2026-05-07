import { Router } from "express";
import { z } from "zod";
import { getAccountById } from "../db/accounts.js";
import { sessions } from "../zalo/manager.js";
import { findByPhone, sendByPhone } from "../zalo/contacts.js";
import { fail, failFromError, failValidation, ok } from "../http/response.js";

export const quickRouter: Router = Router();

const AccountParam = z.object({ accountId: z.string().uuid() });

const FindBody = z.object({
    phone: z.string().min(3),
});

const SendBody = z.object({
    phone: z.string().min(3),
    message: z.union([z.string().min(1), z.record(z.unknown())]),
});

/**
 * POST /quick/:accountId/find-by-phone — body { phone }
 */
quickRouter.post("/:accountId/find-by-phone", async (req, res) => {
    const started = Date.now();
    const params = AccountParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const body = FindBody.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);

    const account = await getAccountById(params.data.accountId);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");

    try {
        const api = await sessions.get(account.id);
        const result = await findByPhone(api, body.data.phone);
        ok(res, result, 200, started);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Lookup failed";
        if (message.startsWith("Không tìm thấy user")) {
            return fail(res, "NOT_FOUND", message);
        }
        failFromError(res, err, "ZALO_ERROR");
    }
});

/**
 * POST /quick/:accountId/send-by-phone — body { phone, message }
 */
quickRouter.post("/:accountId/send-by-phone", async (req, res) => {
    const started = Date.now();
    const params = AccountParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const body = SendBody.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);

    const account = await getAccountById(params.data.accountId);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");

    try {
        const api = await sessions.get(account.id);
        const result = await sendByPhone(api, body.data);
        ok(res, result, 200, started);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Send failed";
        if (message.startsWith("Không tìm thấy user")) {
            return fail(res, "NOT_FOUND", message);
        }
        failFromError(res, err, "ZALO_ERROR");
    }
});
