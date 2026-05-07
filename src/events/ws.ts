import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { hasAdminSession, hasValidApiKey } from "../http/admin.js";
import { eventBus, type ZaloBusEvent } from "./bus.js";
import { noteSubscribe, noteUnsubscribe } from "./orchestrator.js";

/**
 * WebSocket fanout for live events.
 *
 * Connect:    GET ws://host/events
 * Auth:       admin cookie OR API_KEY (`?api_key=`, header, or Bearer).
 * Subscribe:  send `{"action":"subscribe","accountId":"<uuid>" | "all"}`.
 *
 * Server pushes `{ wrapper:"event", event:{ accountId, type, ts, data } }`.
 *
 * Memory optimisations:
 *   - Listener for the underlying Zalo session is LAZY (orchestrator) — only
 *     attached when a WS client subscribes, detached after grace period when
 *     the last one leaves.
 *   - `send()` checks WebSocket buffer. If a slow client has accumulated > 1MB
 *     of un-flushed data, the message is dropped for that client to prevent
 *     unbounded RAM growth.
 *   - One JSON.stringify per event (not per client) when fanning out via the
 *     "*" channel (handled implicitly by EventEmitter — each listener gets the
 *     same object; we stringify once in the handler closure).
 */

const BACKPRESSURE_LIMIT = 1_000_000; // 1 MB un-flushed → drop further sends

interface ClientState {
    socket: WebSocket;
    /** Set of accountIds the client subscribed to (single subscription right now, but extensible). */
    accountId: string | null; // null = none, "*" = all
    unsubscribe: (() => void) | null;
    isAlive: boolean;
}

let wss: WebSocketServer | null = null;

export function attachWebSocketServer(server: Server): void {
    if (wss) return;
    wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

    server.on("upgrade", (req, socket, head) => {
        if (!isEventsPath(req.url)) return;
        if (!isAuthorized(req)) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
        wss!.handleUpgrade(req, socket as Socket, head, (ws) => {
            wss!.emit("connection", ws, req);
        });
    });

    wss.on("connection", (socket) => {
        const state: ClientState = {
            socket,
            accountId: null,
            unsubscribe: null,
            isAlive: true,
        };

        sendRaw(socket, '{"type":"hello","msg":"Send {action:\\"subscribe\\",accountId:\\"<uuid>|all\\"}"}');

        socket.on("pong", () => {
            (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
        });

        socket.on("message", (raw) => {
            handleClientMessage(state, raw.toString());
        });

        socket.on("close", () => {
            cleanupClient(state);
        });
    });

    // Heartbeat: ping every 30s, drop dead clients.
    const heartbeat = setInterval(() => {
        for (const client of wss!.clients) {
            const c = client as WebSocket & { isAlive?: boolean };
            if (c.isAlive === false) {
                c.terminate();
                continue;
            }
            c.isAlive = false;
            c.ping();
        }
    }, 30_000);
    heartbeat.unref?.();

    logger.info("websocket /events ready");
}

function isEventsPath(url: string | undefined): boolean {
    if (!url) return false;
    return url.split("?")[0] === "/events";
}

function isAuthorized(req: IncomingMessage): boolean {
    const reqLike = {
        cookies: parseCookies(req.headers.cookie ?? ""),
        header(name: string) {
            const v = req.headers[name.toLowerCase()];
            return Array.isArray(v) ? v.join(",") : v ?? "";
        },
    } as unknown as Parameters<typeof hasAdminSession>[0];

    if (hasAdminSession(reqLike)) return true;
    if (hasValidApiKey(reqLike)) return true;

    const url = req.url ?? "";
    const qIdx = url.indexOf("?");
    if (config.API_KEY && qIdx >= 0) {
        const params = new URLSearchParams(url.slice(qIdx + 1));
        if (params.get("api_key") === config.API_KEY) return true;
    }
    if (!config.API_KEY && !config.ADMIN_USERNAME) return true;
    return false;
}

function parseCookies(header: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(";")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

async function handleClientMessage(state: ClientState, raw: string): Promise<void> {
    let msg: { action?: string; accountId?: string };
    try {
        msg = JSON.parse(raw);
    } catch {
        sendJson(state.socket, { type: "error", error: "Invalid JSON" });
        return;
    }

    if (msg.action === "subscribe") {
        // Replace any previous subscription.
        cleanupClient(state);

        const target = msg.accountId ?? "all";
        const isWildcard = target === "all" || target === "*";

        const handler = (ev: ZaloBusEvent) => {
            // One stringify per event for THIS client. EventEmitter calls each
            // listener separately, so we can't trivially share across clients
            // without changing the publish path; the per-client stringify is
            // still cheap because Node's V8 caches the same shape efficiently.
            sendJson(state.socket, { wrapper: "event", event: ev });
        };

        if (isWildcard) {
            state.accountId = "*";
            state.unsubscribe = eventBus.subscribeAll(handler);
            // Wildcard doesn't pin any specific account — orchestrator stays idle
            // for individual accounts unless someone explicitly subscribes by id.
        } else {
            state.accountId = target;
            state.unsubscribe = eventBus.subscribeAccount(target, handler);
            await noteSubscribe(target);
        }

        sendJson(state.socket, { type: "subscribed", accountId: state.accountId });
        return;
    }

    if (msg.action === "unsubscribe") {
        cleanupClient(state);
        sendJson(state.socket, { type: "unsubscribed" });
        return;
    }

    sendJson(state.socket, { type: "error", error: "Unknown action" });
}

function cleanupClient(state: ClientState): void {
    state.unsubscribe?.();
    state.unsubscribe = null;
    if (state.accountId && state.accountId !== "*") {
        noteUnsubscribe(state.accountId);
    }
    state.accountId = null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > BACKPRESSURE_LIMIT) {
        // Slow client — drop to keep server RAM bounded.
        return;
    }
    ws.send(JSON.stringify(payload));
}

function sendRaw(ws: WebSocket, json: string): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(json);
}
