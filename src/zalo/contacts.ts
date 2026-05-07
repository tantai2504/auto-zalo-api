import type { Zalo } from "zca-js";

type ZaloApi = Awaited<ReturnType<Zalo["login"]>>;

/**
 * Convenience helpers built on top of the raw zca-js methods so callers don't
 * have to chain findUser → sendMessage by hand.
 */

export interface UserBasicLike {
    uid: string;
    display_name?: string;
    zalo_name?: string;
    avatar?: string;
    cover?: string;
    gender?: number | string;
    dob?: number;
    sdob?: string;
    globalId?: string;
    status?: string;
}

export interface FindByPhoneResult {
    phone: string;
    user: UserBasicLike;
}

/**
 * Look a user up by phone number. Normalises the phone so callers can pass any
 * of `0xxxxxxxxx`, `+84xxxxxxxxx`, `84xxxxxxxxx`. Throws if Zalo returns no match.
 */
export async function findByPhone(
    api: ZaloApiLike,
    phoneRaw: string,
): Promise<FindByPhoneResult> {
    const phone = phoneRaw.trim();
    if (!phone) throw new Error("phone is required");

    const candidates = candidatePhoneFormats(phone);
    let lastErr: unknown;
    for (const p of candidates) {
        try {
            const user = (await api.findUser(p)) as UserBasicLike | null;
            if (user && user.uid) {
                return { phone: p, user };
            }
        } catch (err) {
            lastErr = err;
        }
    }
    if (lastErr) {
        throw new Error(
            `Không tìm thấy user cho phone '${phone}': ${
                lastErr instanceof Error ? lastErr.message : String(lastErr)
            }`,
        );
    }
    throw new Error(`Không tìm thấy user cho phone '${phone}'`);
}

export interface SendByPhoneInput {
    phone: string;
    message: string | Record<string, unknown>;
}

export interface SendByPhoneResult {
    phone: string;
    user: UserBasicLike;
    sendResult: unknown;
}

/**
 * Send a 1-1 message by phone number. Resolves phone → uid via findUser, then
 * calls sendMessage(message, uid, ThreadType.User).
 */
export async function sendByPhone(
    api: ZaloApiLike,
    input: SendByPhoneInput,
): Promise<SendByPhoneResult> {
    const found = await findByPhone(api, input.phone);
    const messagePayload =
        typeof input.message === "string"
            ? { msg: input.message }
            : { msg: "", ...input.message };
    const sendResult = await api.sendMessage(
        messagePayload as { msg: string },
        found.user.uid,
        0,
    );
    return { phone: found.phone, user: found.user, sendResult };
}

/**
 * Generate alternate forms of a Vietnamese phone number for fallback lookup.
 * Zalo's findUser is picky about formatting — it usually wants the full
 * international form (+84...), but we try the common variants in order.
 */
function candidatePhoneFormats(phone: string): string[] {
    const digits = phone.replace(/[^0-9+]/g, "");
    const out = new Set<string>();
    out.add(digits);

    if (digits.startsWith("+")) {
        out.add(digits.slice(1));
    } else if (digits.startsWith("0")) {
        // Vietnamese local form: convert leading 0 to +84
        out.add("+84" + digits.slice(1));
        out.add("84" + digits.slice(1));
    } else if (digits.startsWith("84")) {
        out.add("+" + digits);
    } else {
        out.add("+" + digits);
    }
    return [...out];
}

/**
 * Loose interface that matches zca-js's API class for the methods we touch.
 * Keeps us decoupled from version-specific exported types.
 */
interface ZaloApiLike {
    findUser: ZaloApi["findUser"];
    sendMessage: ZaloApi["sendMessage"];
}
