import { Router } from "express";
import { z } from "zod";
import { getAccountById } from "../db/accounts.js";
import { sessions } from "../zalo/manager.js";
import { fail, failFromError, failValidation, ok } from "../http/response.js";
import { loadSignatures } from "../zalo/parseSignatures.js";
import { findByPhone, listGroups, sendByPhone } from "../zalo/contacts.js";
import { queryMessages } from "../db/messages.js";

export const apiRouter: Router = Router();

/**
 * Convenience wrappers exposed as if they were native methods. They call
 * `findUser` + `sendMessage` underneath but accept a phone number directly,
 * with VN phone-format auto-fallback (`0xxx`, `84xxx`, `+84xxx`).
 *
 * Show up in the catalog under "User & Account" and "Messaging" so they
 * appear in the docs alongside the real methods.
 */
type ZaloApi = Parameters<typeof findByPhone>[0];
type Handler = (api: ZaloApi, args: unknown[], accountId: string) => Promise<unknown>;

const VIRTUAL_METHODS: Record<string, { paramNames: string[]; handler: Handler }> = {
    findByPhone: {
        paramNames: ["phoneNumber"],
        handler: (api, args) => findByPhone(api, String(args[0] ?? "")),
    },
    sendByPhone: {
        paramNames: ["phoneNumber", "message"],
        handler: (api, args) =>
            sendByPhone(api, {
                phone: String(args[0] ?? ""),
                message: args[1] as string | Record<string, unknown>,
            }),
    },
    listGroups: {
        paramNames: [],
        handler: (api) => listGroups(api as unknown as Parameters<typeof listGroups>[0]),
    },
    getMessages: {
        paramNames: ["threadId", "threadType", "limit", "since", "before", "order"],
        handler: async (_api, args, accountId) => {
            const [threadId, threadType, limit, since, before, order] = args;
            return queryMessages({
                accountId,
                threadId: typeof threadId === "string" && threadId ? threadId : undefined,
                threadType:
                    threadType === 0 || threadType === 1 ? (threadType as 0 | 1) : undefined,
                limit: typeof limit === "number" ? limit : undefined,
                since: typeof since === "number" ? since : undefined,
                before: typeof before === "number" ? before : undefined,
                order: order === "asc" ? "asc" : order === "desc" ? "desc" : undefined,
            });
        },
    },
};

/**
 * Generic Zalo method proxy.
 *
 * POST /api/:accountId/:method
 *
 * Body — accepts FOUR shapes (server tự convert thành mảng args positional):
 *
 * 1. **Named-field object** ⭐ (khuyến nghị) — keys khớp tên tham số method:
 *      `{ "groupId": "abc" }` → getGroupInfo(groupId)
 *      `{ "message": "Hi", "threadId": "xxx", "type": 0 }` → sendMessage(message, threadId, type)
 *
 * 2. **Object phẳng** cho method nhận 1 object — body = chính object đó:
 *      `{ "name": "Group", "members": ["uid1"] }` → createGroup(options)
 *
 * 3. **Array trực tiếp** — positional args:
 *      `[{"msg":"Hi"}, "userId", 0]` → spread vào method(...args)
 *
 * 4. **Legacy wrapper** `{ "args": [...] }` — backwards compat:
 *      `{ "args": ["abc"] }`
 *
 * 5. **Rỗng** — method không tham số:
 *      `{}` hoặc `[]` hoặc no body
 */
const ParamsSchema = z.object({
    accountId: z.string().uuid(),
    method: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
});

apiRouter.post("/:accountId/:method", async (req, res) => {
    const started = Date.now();
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) return failValidation(res, params.error);

    const account = await getAccountById(params.data.accountId);
    if (!account) return fail(res, "NOT_FOUND", "Account not found");

    const transformed = transformBody(req.body, params.data.method);
    if (transformed === null) {
        return fail(
            res,
            "VALIDATION_ERROR",
            `Body shape không hợp lệ. Dùng object {tên_param: giá_trị}, ` +
                `array [...], hoặc rỗng. Xem /methods/${params.data.method} để biết tên các tham số.`,
        );
    }

    try {
        const api = await sessions.get(account.id);
        const virtual = VIRTUAL_METHODS[params.data.method];
        if (virtual) {
            const result = await virtual.handler(api as ZaloApi, transformed, account.id);
            ok(res, result, 200, started);
            return;
        }
        const apiAsRecord = api as unknown as Record<string, unknown>;
        const fn = apiAsRecord[params.data.method];
        if (typeof fn !== "function") {
            return fail(res, "NOT_FOUND", `Method '${params.data.method}' not found on api`);
        }
        const result = await Promise.resolve(
            (fn as (...a: unknown[]) => unknown).apply(apiAsRecord, transformed),
        );
        ok(res, result, 200, started);
    } catch (err) {
        failFromError(res, err, "ZALO_ERROR");
    }
});

/**
 * Map a request body to the positional args array the underlying method needs.
 * Returns `null` if the body shape can't be reconciled with the method signature.
 *
 * Resolution order (first match wins):
 *   1. body is undefined/null/{} → []
 *   2. body is an array → use as-is
 *   3. body is `{ args: [...] }` and ONLY that key → return `args` (legacy)
 *   4. body keys all match the method's param names → spread by name
 *   5. method has exactly 1 param and body is a non-empty object → wrap body as [body]
 *   6. otherwise → null (unknown shape)
 */
function transformBody(body: unknown, method: string): unknown[] | null {
    if (body === undefined || body === null) return [];
    if (Array.isArray(body)) return body;
    if (typeof body !== "object") return null;

    const obj = body as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return [];

    // Legacy wrapper
    if (keys.length === 1 && keys[0] === "args" && Array.isArray(obj.args)) {
        return obj.args as unknown[];
    }

    const paramNames = paramNamesOf(method);
    if (!paramNames) {
        // Method not in our signature table — fall back to single-arg wrap.
        return [obj];
    }

    // All body keys map to a param name → spread by name (handles partial / optional).
    const allMatch = keys.every((k) => paramNames.includes(k));
    if (allMatch) {
        return paramNames.map((p) => obj[p]);
    }

    // Single-arg method receiving an object → wrap as that arg.
    if (paramNames.length === 1) {
        return [obj];
    }

    return null;
}

const paramNameCache = new Map<string, string[]>();

/** Look up the positional param names of a method (real or virtual). */
function paramNamesOf(method: string): string[] | null {
    if (VIRTUAL_METHODS[method]) return VIRTUAL_METHODS[method].paramNames;
    if (paramNameCache.has(method)) return paramNameCache.get(method)!;
    const sig = loadSignatures()[method];
    if (!sig) return null;
    const names = parseParamNames(sig.params);
    paramNameCache.set(method, names);
    return names;
}

function parseParamNames(paramsStr: string): string[] {
    const inner = paramsStr.replace(/^\(|\)$/g, "").trim();
    if (!inner) return [];
    const parts: string[] = [];
    let depth = 0;
    let buf = "";
    for (const ch of inner) {
        if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
        else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
            parts.push(buf.trim());
            buf = "";
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts.map((p) => {
        const m = /^([\w$]+)(\?)?\s*:/.exec(p);
        return m && m[1] ? m[1] : p.trim();
    });
}
