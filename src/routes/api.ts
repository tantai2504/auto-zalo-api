import { Router } from "express";
import { z } from "zod";
import { getAccountById } from "../db/accounts.js";
import { sessions } from "../zalo/manager.js";
import { fail, failFromError, failValidation, ok } from "../http/response.js";

export const apiRouter: Router = Router();

/**
 * Generic zca-js method proxy.
 *
 * POST /api/:accountId/:method
 *   body: { args: unknown[] }
 *
 * Looks up the live session for the account, then invokes
 * `api[method](...args)`. Exposes the entire zca-js surface (~145 methods).
 */
const ParamsSchema = z.object({
    accountId: z.string().uuid(),
    method: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
});

const BodySchema = z.object({
    args: z.array(z.unknown()).default([]),
});

apiRouter.post("/:accountId/:method", async (req, res) => {
    const started = Date.now();
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const body = BodySchema.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);

    const account = await getAccountById(params.data.accountId);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");

    try {
        const api = (await sessions.get(account.id)) as unknown as Record<
            string,
            unknown
        >;
        const fn = api[params.data.method];
        if (typeof fn !== "function") {
            return fail(
                res,
                "NOT_FOUND",
                `Method '${params.data.method}' not found on api`,
            );
        }
        const result = await Promise.resolve(
            (fn as (...a: unknown[]) => unknown).apply(api, body.data.args),
        );
        ok(res, result, 200, started);
    } catch (err) {
        failFromError(res, err, "ZALO_ERROR");
    }
});
