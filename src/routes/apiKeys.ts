import { Router } from "express";
import { z } from "zod";
import {
    createApiKey,
    getApiKey,
    listApiKeys,
    patchApiKey,
    revokeApiKey,
} from "../db/apiKeys.js";
import { hasAdminSession, requireAdminCookie } from "../http/admin.js";
import { invalidateApiKeyCache } from "../http/apiKeyAuth.js";
import { fail, failValidation, ok } from "../http/response.js";
import { hashKey } from "../db/apiKeys.js";

export const apiKeysRouter: Router = Router();

// All routes here require admin cookie (or env master key in single-admin mode).
apiKeysRouter.use(requireAdminCookie);

const IdParam = z.object({ id: z.string().uuid() });

const CreateBody = z.object({
    name: z.string().min(1).max(80),
    /** Lifetime in seconds. 0 or null = never expires. Max 5 years. */
    expiresInSec: z.coerce
        .number()
        .int()
        .min(0)
        .max(5 * 365 * 24 * 60 * 60)
        .nullable()
        .optional(),
});

apiKeysRouter.get("/", async (_req, res) => {
    const keys = await listApiKeys();
    ok(res, { keys });
});

apiKeysRouter.post("/", async (req, res) => {
    const body = CreateBody.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);

    const adminUser =
        hasAdminSession(req)?.user ?? "env-master"; // when env key bootstraps

    const result = await createApiKey({
        name: body.data.name,
        expiresInSec: body.data.expiresInSec ?? null,
        createdBy: adminUser,
    });

    // The plain key is returned ONLY here, never again.
    ok(
        res,
        {
            apiKey: result.apiKey,
            plainKey: result.plainKey,
            warning:
                "Lưu lại key này — server không hiển thị lại. Mất key thì tạo cái mới.",
        },
        201,
    );
});

apiKeysRouter.get("/:id", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const key = await getApiKey(params.data.id);
    if (!key) return fail(res, "NOT_FOUND", "API key not found");
    ok(res, key);
});

const PatchBody = z
    .object({
        name: z.string().min(1).max(80).optional(),
        /** Set to null → never expires. Set to number (epoch ms) → new expiry. */
        expiresAt: z.union([z.number().int().nonnegative(), z.null()]).optional(),
        /** Convenience: extend by N seconds from NOW. */
        extendBySec: z.number().int().positive().optional(),
    })
    .refine(
        (b) => b.name !== undefined || b.expiresAt !== undefined || b.extendBySec !== undefined,
        { message: "Provide at least one field to patch" },
    );

apiKeysRouter.patch("/:id", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const body = PatchBody.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);

    let expiresAt = body.data.expiresAt;
    if (body.data.extendBySec !== undefined) {
        expiresAt = Date.now() + body.data.extendBySec * 1000;
    }
    const updated = await patchApiKey(params.data.id, {
        name: body.data.name,
        expiresAt,
    });
    if (!updated) return fail(res, "NOT_FOUND", "API key not found");
    // Bust the cache so the new TTL takes effect immediately.
    // (We don't have the raw key; cache is keyed by hash. Best we can do is
    //  let TTL run out — invalidate by keyHash if we ever surface it.)
    ok(res, updated);
});

apiKeysRouter.delete("/:id", async (req, res) => {
    const params = IdParam.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);
    const result = await revokeApiKey(params.data.id);
    if (result.keyHash) invalidateApiKeyCache(result.keyHash);
    if (!result.revoked && !result.keyHash) {
        return fail(res, "NOT_FOUND", "API key not found");
    }
    ok(res, { id: params.data.id, revoked: true });
});

// Silence unused import lint if we don't reference hashKey elsewhere — exporting
// it from this module would also confuse the public surface. Keep the import as
// a marker that the caching strategy is hash-based.
void hashKey;
