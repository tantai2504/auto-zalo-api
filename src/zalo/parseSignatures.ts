import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lightweight parser that extracts the user-facing method signature out of
 * each `node_modules/zca-js/dist/apis/<name>.d.ts` file.
 *
 * Each file ends with a declaration of the form:
 *   export declare const <name>Factory: (ctx, api) => (<params>) => Promise<<ret>>;
 *
 * We strip the outer factory wrapper and keep just the `(<params>) => Promise<<ret>>`
 * part so the API explorer can show a real signature instead of "any args".
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function findApisDir(): string {
    // src/zalo → walk up to project root, then into node_modules/zca-js/dist/apis
    const candidates = [
        resolve(HERE, "../../node_modules/zca-js/dist/apis"),
        resolve(HERE, "../../../node_modules/zca-js/dist/apis"),
        resolve(process.cwd(), "node_modules/zca-js/dist/apis"),
    ];
    for (const c of candidates) {
        try {
            readdirSync(c);
            return c;
        } catch {
            // try next
        }
    }
    throw new Error("Could not locate zca-js/dist/apis");
}

export interface ParsedSignature {
    method: string;
    params: string;
    returnType: string;
}

const FACTORY_RE = /export\s+declare\s+const\s+(\w+)Factory\s*:/;

/**
 * Skip past the outer wrapper `(ctx, api) => ` and return the index immediately
 * after that arrow. Uses balanced-paren scanning so types containing `()` or
 * `<>` don't confuse it.
 */
function skipOuterWrapper(src: string, start: number): number {
    let i = src.indexOf("(", start);
    if (i < 0) return -1;
    let depth = 0;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === "(") depth++;
        else if (c === ")") {
            depth--;
            if (depth === 0) {
                // expect "=> " right after
                const arrowIdx = src.indexOf("=>", i);
                if (arrowIdx < 0) return -1;
                return arrowIdx + 2;
            }
        }
    }
    return -1;
}

/**
 * From `(params) => Promise<...>;`, extract `(params)` and `Promise<...>`.
 * Returns null if the shape doesn't match.
 */
function splitInnerSignature(
    src: string,
    start: number,
): { params: string; returnType: string } | null {
    // Skip whitespace
    while (start < src.length && /\s/.test(src[start]!)) start++;
    if (src[start] !== "(") return null;

    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === "(") depth++;
        else if (c === ")") {
            depth--;
            if (depth === 0) {
                i++;
                break;
            }
        }
    }
    const params = src.slice(start, i).trim();
    // Now expect `=> <returnType>;`
    const arrowIdx = src.indexOf("=>", i);
    if (arrowIdx < 0) return null;
    let retStart = arrowIdx + 2;
    while (retStart < src.length && /\s/.test(src[retStart]!)) retStart++;
    // The return type is balanced angle / paren brackets up until the trailing `;`
    let angle = 0;
    let paren = 0;
    let curly = 0;
    let j = retStart;
    for (; j < src.length; j++) {
        const c = src[j];
        if (c === "<") angle++;
        else if (c === ">") angle--;
        else if (c === "(") paren++;
        else if (c === ")") paren--;
        else if (c === "{") curly++;
        else if (c === "}") curly--;
        else if (c === ";" && angle === 0 && paren === 0 && curly === 0) break;
    }
    const returnType = src.slice(retStart, j).trim();
    return { params, returnType };
}

let CACHE: Record<string, ParsedSignature> | null = null;

export function loadSignatures(): Record<string, ParsedSignature> {
    if (CACHE) return CACHE;
    const dir = findApisDir();
    const files = readdirSync(dir).filter((f) => f.endsWith(".d.ts"));
    const out: Record<string, ParsedSignature> = {};
    for (const file of files) {
        const src = readFileSync(`${dir}/${file}`, "utf8");
        const m = FACTORY_RE.exec(src);
        if (!m) continue;
        const method = m[1]!;
        const afterColon = m.index + m[0].length;
        const innerStart = skipOuterWrapper(src, afterColon);
        if (innerStart < 0) continue;
        const sig = splitInnerSignature(src, innerStart);
        if (!sig) continue;
        out[method] = { method, params: sig.params, returnType: sig.returnType };
    }
    CACHE = out;
    return out;
}
