import { Router } from "express";
import { z } from "zod";
import { getAccountById } from "../db/accounts.js";
import { sessions } from "../zalo/manager.js";
import { fail, failFromError, failValidation, ok } from "../http/response.js";

export const apiRouter: Router = Router();

/**
 * Generic Zalo method proxy.
 *
 * POST /api/:accountId/:method
 *
 * Body — accepts THREE shapes (in order of preference):
 *   1. Empty body                → method called with zero args
 *   2. Direct array `[a, b, c]`  → spread as positional args (recommended)
 *   3. Wrapped `{ "args": [...] }` → legacy, still accepted
 *
 * Looks up the live session for the account, then invokes
 * `api[method](...args)`. Exposes the entire underlying API surface (~145 methods).
 */
const ParamsSchema = z.object({
    accountId: z.string().uuid(),
    method: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
});

apiRouter.post("/:accountId/:method", async (req, res) => {
    const started = Date.now();
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);

    // Three accepted body shapes — coerce all to a single args array.
    const args = parseArgsFromBody(req.body);
    if (args === null) {
        return fail(
            res,
            "VALIDATION_ERROR",
            "Body phải là array trực tiếp [a, b, c], hoặc { args: [...] }, hoặc rỗng.",
        );
    }

    const account = await getAccountById(params.data.accountId);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");

    try {
        const api = (await sessions.get(account.id)) as unknown as Record<string, unknown>;
        const fn = api[params.data.method];
        if (typeof fn !== "function") {
            return fail(res, "NOT_FOUND", `Method '${params.data.method}' not found on api`);
        }
        const result = await Promise.resolve(
            (fn as (...a: unknown[]) => unknown).apply(api, args),
        );
        ok(res, result, 200, started);
    } catch (err) {
        failFromError(res, err, "ZALO_ERROR");
    }
});

/**
 * Normalise the request body to the positional args array.
 * Returns null if the body shape is invalid.
 */
function parseArgsFromBody(body: unknown): unknown[] | null {
    if (body === undefined || body === null) return [];
    if (Array.isArray(body)) return body;
    if (typeof body === "object") {
        const obj = body as Record<string, unknown>;
        // Empty object {} → no args. Common when client sends nothing.
        if (Object.keys(obj).length === 0) return [];
        // Legacy wrapper { args: [...] }
        if (Array.isArray(obj.args)) return obj.args;
    }
    return null;
}
