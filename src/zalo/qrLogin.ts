import QRCode from "qrcode";
import {
    LoginQRCallbackEventType,
    Zalo,
    type LoginQRCallbackEvent,
} from "zca-js";
import { logger } from "../logger.js";
import { upsertAccount } from "../db/accounts.js";
import { updateQrSession } from "../db/qrSessions.js";
import { extractCredentials, pickAccountIdentity } from "./extract.js";
import type { StoredCredentials } from "./types.js";

/**
 * Run the QR login flow for a single qr_session row.
 *
 * Lifecycle (driven by zca-js's loginQR callback):
 *   pending  -> QR image generated and persisted as a data URL
 *   scanned  -> user scanned the QR on phone (we capture early displayName/avatar)
 *   success  -> session is live; credentials extracted and account upserted
 *   failed   -> declined / abort / unhandled error
 *   expired  -> QR not scanned in time
 */
export async function runQrLogin(qrSessionId: string): Promise<void> {
    const zalo = new Zalo({
        selfListen: false,
        checkUpdate: false,
        logging: false,
    });

    let scannedDisplayName: string | null = null;

    let api: Awaited<ReturnType<Zalo["loginQR"]>> | null = null;
    try {
        api = await zalo.loginQR(undefined, async (event: LoginQRCallbackEvent) => {
            try {
                scannedDisplayName = await handleQrEvent(
                    qrSessionId,
                    event,
                    scannedDisplayName,
                );
            } catch (err) {
                logger.error({ err, qrSessionId, eventType: event.type }, "QR callback failed");
            }
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, qrSessionId }, "loginQR failed");
        await updateQrSession(qrSessionId, { status: "failed", error: msg });
        return;
    }

    if (!api) {
        await updateQrSession(qrSessionId, {
            status: "failed",
            error: "loginQR resolved without an API instance",
        });
        return;
    }

    try {
        const credentials: StoredCredentials = extractCredentials(api);
        let identity: { phone: string | null; displayName: string | null } = {
            phone: null,
            displayName: scannedDisplayName,
        };
        try {
            const info = (await api.fetchAccountInfo()) as Record<string, unknown> | null;
            const fromInfo = pickAccountIdentity(info as never);
            identity = {
                phone: fromInfo.phone,
                displayName: fromInfo.displayName ?? scannedDisplayName,
            };
        } catch (err) {
            logger.warn({ err, qrSessionId }, "fetchAccountInfo failed (non-fatal)");
        }

        const account = await upsertAccount({
            uid: credentials.uid,
            phone: identity.phone,
            displayName: identity.displayName,
            imei: credentials.imei,
            userAgent: credentials.userAgent,
            language: credentials.language,
            credentials,
        });

        await updateQrSession(qrSessionId, {
            status: "success",
            accountId: account.id,
            error: null,
        });
        logger.info(
            { qrSessionId, accountId: account.id, uid: account.uid },
            "qr login success",
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, qrSessionId }, "post-login extraction failed");
        await updateQrSession(qrSessionId, { status: "failed", error: msg });
    }
}

async function handleQrEvent(
    qrSessionId: string,
    event: LoginQRCallbackEvent,
    prevDisplayName: string | null,
): Promise<string | null> {
    switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated: {
            const dataUrl = await buildQrDataUrl(event.data.image, event.data.code);
            await updateQrSession(qrSessionId, { status: "pending", qrDataUrl: dataUrl });
            return prevDisplayName;
        }
        case LoginQRCallbackEventType.QRCodeScanned: {
            await updateQrSession(qrSessionId, { status: "scanned" });
            return event.data.display_name ?? prevDisplayName;
        }
        case LoginQRCallbackEventType.QRCodeExpired: {
            await updateQrSession(qrSessionId, {
                status: "expired",
                error: "QR code expired",
            });
            return prevDisplayName;
        }
        case LoginQRCallbackEventType.QRCodeDeclined: {
            await updateQrSession(qrSessionId, {
                status: "failed",
                error: "QR scan declined on device",
            });
            return prevDisplayName;
        }
        case LoginQRCallbackEventType.GotLoginInfo:
            // The post-login flow above handles success persistence.
            return prevDisplayName;
    }
}

async function buildQrDataUrl(image: string, fallbackCode: string): Promise<string> {
    if (image) {
        // zca-js emits the PNG as base64 already
        return `data:image/png;base64,${image}`;
    }
    return QRCode.toDataURL(fallbackCode, { width: 300, margin: 1 });
}
