import type { Cookie } from "tough-cookie";
import type { StoredCredentials } from "./types.js";

const ZALO_URL = "https://chat.zalo.me";

/**
 * Structural shape of the CookieJar returned by `api.getCookie()` — duck-typed
 * because zca-js bundles its own tough-cookie copy whose nominal types don't
 * match the @types/tough-cookie we install at the project root.
 */
export interface JarLike {
    getCookiesSync(currentUrl: string, options?: { allPaths?: boolean }): Array<{
        key: string;
        value: string;
    }>;
    serializeSync(): { cookies: Cookie.Serialized[] } | undefined;
}

export interface ZaloApiLike {
    getCookie: () => JarLike;
    getContext: () => {
        uid: string;
        imei: string;
        userAgent: string;
        language: string;
        secretKey: string;
    };
}

function snapshotCookies(jar: JarLike): StoredCredentials["cookieSnapshot"] {
    const cookies = jar.getCookiesSync(ZALO_URL, { allPaths: true });
    const snap: StoredCredentials["cookieSnapshot"] = {};
    for (const c of cookies) {
        snap[c.key] = c.value;
    }
    return snap;
}

/**
 * Build the persisted credentials blob from a freshly-logged-in zca-js API instance.
 * Stores the cookie jar in tough-cookie's `Cookie.Serialized[]` form so re-login can
 * pass it directly to `zalo.login({ cookie })`.
 */
export function extractCredentials(api: ZaloApiLike): StoredCredentials {
    const jar = api.getCookie();
    const ctx = api.getContext();
    const serialized = jar.serializeSync();
    return {
        cookie: serialized?.cookies ?? [],
        imei: ctx.imei,
        userAgent: ctx.userAgent,
        language: ctx.language,
        secretKey: ctx.secretKey,
        uid: ctx.uid,
        cookieSnapshot: snapshotCookies(jar),
    };
}

interface UserProfileLike {
    userId?: string;
    displayName?: string;
    zaloName?: string;
    phoneNumber?: string;
}

/**
 * `api.fetchAccountInfo()` actually resolves to `{ biz, profile }` despite the
 * docs typing it as `User`. Accept both shapes — flat User or nested profile —
 * so a future zca-js version that flattens this won't break us.
 */
export type AccountInfoLike =
    | UserProfileLike
    | { profile?: UserProfileLike | null; biz?: unknown }
    | null
    | undefined;

export function pickAccountIdentity(info: AccountInfoLike): {
    phone: string | null;
    displayName: string | null;
} {
    if (!info) return { phone: null, displayName: null };
    const profile: UserProfileLike =
        "profile" in info && info.profile ? info.profile : (info as UserProfileLike);
    return {
        phone: profile.phoneNumber ?? null,
        displayName: profile.displayName ?? profile.zaloName ?? null,
    };
}
