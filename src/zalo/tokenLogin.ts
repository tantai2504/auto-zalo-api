import { Zalo } from "zca-js";
import { logger } from "../logger.js";
import { upsertAccount, type AccountPublic } from "../db/accounts.js";
import { extractCredentials, pickAccountIdentity } from "./extract.js";
import type { StoredCredentials } from "./types.js";

/**
 * Default User-Agent used when the caller doesn't provide one.
 * Matches a recent Chrome on Windows — this matters because Zalo's auth ties
 * the cookie to the UA string used at login. Mismatches can refuse the session.
 */
const DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_LANGUAGE = "vi";

export interface TokenLoginInput {
    /** z_uuid value (browser localStorage `z_uuid` or `sh_z_uuid`) — used as imei. */
    zUuid: string;
    /** zpw_sek cookie value (the long `xxx.123.a0.xxx` string). */
    zpwSek: string;
    userAgent?: string;
    language?: string;
    /** Caller-supplied identity that overrides whatever we pull from Zalo. */
    phoneOverride?: string | null;
    displayNameOverride?: string | null;
}

/**
 * Decode the base64-encoded JSON shape produced by browser exporter tools, e.g.:
 *   { "z_uuid": "...", "ZaloCookies": "<zpw_sek value>" }
 * Throws if decoding or shape validation fails.
 */
export function decodeTokenPayload(token: string): TokenLoginInput {
    let json: string;
    try {
        json = Buffer.from(token.trim(), "base64").toString("utf8");
    } catch (err) {
        throw new Error("Token is not valid base64");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error("Decoded token is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Decoded token must be an object");
    }
    const obj = parsed as Record<string, unknown>;
    const zUuid = obj.z_uuid ?? obj.zUuid ?? obj.imei;
    const zpwSek = obj.ZaloCookies ?? obj.zpw_sek ?? obj.zpwSek;
    if (typeof zUuid !== "string" || !zUuid) {
        throw new Error("Token missing 'z_uuid'");
    }
    if (typeof zpwSek !== "string" || !zpwSek) {
        throw new Error("Token missing 'ZaloCookies' / 'zpw_sek'");
    }
    const userAgent = typeof obj.userAgent === "string" ? obj.userAgent : undefined;
    const language = typeof obj.language === "string" ? obj.language : undefined;
    return { zUuid, zpwSek, userAgent, language };
}

/**
 * Build the minimal cookie array zca-js needs from a single zpw_sek value.
 * `zpw_sek` is the session-bearing cookie — for most APIs Zalo will accept it
 * by itself, but if you have additional cookies (e.g. `zpw_enk`, `app`) pass
 * them in too via the more general loginWithCookies path.
 */
function buildCookieList(zpwSek: string): Array<{
    domain: string;
    name: string;
    value: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: string;
    hostOnly: boolean;
    session: boolean;
    expirationDate: number;
    storeId: string;
}> {
    const oneYearFromNow = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
    return [
        {
            domain: ".zalo.me",
            name: "zpw_sek",
            value: zpwSek,
            path: "/",
            secure: true,
            httpOnly: false,
            sameSite: "no_restriction",
            hostOnly: false,
            session: false,
            expirationDate: oneYearFromNow,
            storeId: "",
        },
    ];
}

/**
 * Log in with a pre-extracted token, persist the account, return its public row.
 * Throws on auth failure — caller should map that to HTTP 4xx.
 */
export async function loginWithToken(
    input: TokenLoginInput,
): Promise<AccountPublic> {
    const userAgent = input.userAgent ?? DEFAULT_USER_AGENT;
    const language = input.language ?? DEFAULT_LANGUAGE;

    const zalo = new Zalo({
        selfListen: false,
        checkUpdate: false,
        logging: false,
    });

    const api = await zalo.login({
        cookie: buildCookieList(input.zpwSek),
        imei: input.zUuid,
        userAgent,
        language,
    });

    const credentials: StoredCredentials = extractCredentials(api);

    let identity: { phone: string | null; displayName: string | null } = {
        phone: null,
        displayName: null,
    };
    try {
        const info = (await api.fetchAccountInfo()) as Record<string, unknown> | null;
        identity = pickAccountIdentity(info as never);
    } catch (err) {
        logger.warn({ err }, "fetchAccountInfo failed after token login (non-fatal)");
    }

    // Caller-supplied identity wins over what we pulled from Zalo.
    const phone = input.phoneOverride ?? identity.phone;
    const displayName = input.displayNameOverride ?? identity.displayName;

    const account = await upsertAccount({
        uid: credentials.uid,
        phone,
        displayName,
        imei: credentials.imei,
        userAgent: credentials.userAgent,
        language: credentials.language,
        credentials,
    });
    logger.info(
        { accountId: account.id, uid: account.uid },
        "token login success",
    );
    return account;
}
