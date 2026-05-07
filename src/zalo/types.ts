import type { Cookie } from "tough-cookie";

/**
 * Persisted credentials — exactly what's needed to re-instantiate a zca-js session
 * via `zalo.login({ cookie, imei, userAgent })` plus extra metadata captured at login.
 *
 * `cookie` holds the serialized tough-cookie list. Zalo's session cookies
 * (zpw_sek, zpw_enk, app, etc.) live inside there.
 */
export interface StoredCredentials {
    cookie: Cookie.Serialized[];
    /** Device identifier — same as `z_uuid` in browser localStorage */
    imei: string;
    userAgent: string;
    language: string;
    /** From api.getContext().secretKey — the api_key used to sign requests */
    secretKey: string;
    uid: string;
    /** Flat snapshot of cookie values for diagnostics. Re-login should always use the
     *  full `cookie` array, not this. */
    cookieSnapshot: {
        zpw_sek?: string;
        zpw_enk?: string;
        app?: string;
        [key: string]: string | undefined;
    };
}

export interface AccountSummary {
    id: string;
    uid: string;
    phone: string | null;
    displayName: string | null;
    status: string;
    createdAt: number;
}
