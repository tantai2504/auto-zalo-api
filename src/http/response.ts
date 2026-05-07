import type { Response } from "express";
import type { ZodError } from "zod";

/**
 * Single envelope shape used by every endpoint in this service.
 *
 * Success:  { ok: true,  data: T,                          meta: { ts, ms? } }
 * Failure:  { ok: false, error: { code, message, issues? }, meta: { ts } }
 *
 * The `code` field is an internal taxonomy clients can branch on without
 * having to parse `message` (which is human-readable and may be localized).
 */

export type ApiOk<T> = {
    ok: true;
    data: T;
    meta: { ts: number; ms?: number };
};

export type ApiErr = {
    ok: false;
    error: {
        code: ErrorCode;
        message: string;
        issues?: unknown;
    };
    meta: { ts: number };
};

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export type ErrorCode =
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "UNAUTHORIZED"
    | "RATE_LIMITED"
    | "LOGIN_FAILED"
    | "ZALO_ERROR"
    | "INTERNAL_ERROR";

const STATUS_FOR: Record<ErrorCode, number> = {
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    RATE_LIMITED: 429,
    LOGIN_FAILED: 400,
    ZALO_ERROR: 502,
    INTERNAL_ERROR: 500,
};

export function ok<T>(res: Response, data: T, status = 200, startedAt?: number): Response {
    const body: ApiOk<T> = {
        ok: true,
        data,
        meta: {
            ts: Date.now(),
            ...(startedAt !== undefined ? { ms: Date.now() - startedAt } : {}),
        },
    };
    return res.status(status).json(body);
}

export function fail(
    res: Response,
    code: ErrorCode,
    message: string,
    issues?: unknown,
): Response {
    const body: ApiErr = {
        ok: false,
        error: issues !== undefined ? { code, message, issues } : { code, message },
        meta: { ts: Date.now() },
    };
    return res.status(STATUS_FOR[code]).json(body);
}

/** Convenience: turn a zod error into a VALIDATION_ERROR envelope. */
export function failValidation(res: Response, err: ZodError): Response {
    return fail(
        res,
        "VALIDATION_ERROR",
        "Request body or params failed validation",
        err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
            code: i.code,
        })),
    );
}

/**
 * Map a thrown value to the appropriate envelope.
 * Routes that wrap their handler in try/catch can call this from the catch.
 */
export function failFromError(res: Response, err: unknown, fallbackCode: ErrorCode = "INTERNAL_ERROR"): Response {
    if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
        const code = (err as { code: string }).code;
        const message =
            err instanceof Error ? err.message : String((err as { message?: unknown }).message ?? "Error");
        if (isErrorCode(code)) {
            return fail(res, code, message);
        }
    }
    const message = err instanceof Error ? err.message : "Internal error";
    return fail(res, fallbackCode, message);
}

function isErrorCode(s: string): s is ErrorCode {
    return s in STATUS_FOR;
}

/**
 * Domain error you can throw inside handlers; the wrapping catch turns it into
 * the right envelope. Keeps route handlers readable.
 */
export class ApiError extends Error {
    code: ErrorCode;
    issues?: unknown;
    constructor(code: ErrorCode, message: string, issues?: unknown) {
        super(message);
        this.code = code;
        this.issues = issues;
    }
}

export function failFromApiError(res: Response, err: ApiError): Response {
    return fail(res, err.code, err.message, err.issues);
}
