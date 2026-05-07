import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

const KEY = Buffer.from(config.ENCRYPTION_KEY, "hex");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(payload: string): string {
    const buf = Buffer.from(payload, "base64");
    if (buf.length < IV_LENGTH + TAG_LENGTH) {
        throw new Error("Encrypted payload too short");
    }
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptJSON(value: unknown): string {
    return encrypt(JSON.stringify(value));
}

export function decryptJSON<T = unknown>(payload: string): T {
    return JSON.parse(decrypt(payload)) as T;
}
