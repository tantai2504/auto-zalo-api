import { config } from "./config.js";
import { groupedCatalog, METHOD_NAMES } from "./zalo/methodCatalog.js";

/**
 * OpenAPI 3.0 spec for the zalo-auto REST surface.
 *
 * **Every response uses a single envelope:**
 *   - Success: `{ ok: true, data: <T>, meta: { ts, ms? } }`
 *   - Failure: `{ ok: false, error: { code, message, issues? }, meta: { ts } }`
 *
 * Error `code` values: `VALIDATION_ERROR | NOT_FOUND | UNAUTHORIZED | LOGIN_FAILED | ZALO_ERROR | INTERNAL_ERROR`.
 *
 * The big payoff: `POST /api/{accountId}/{method}` proxies any of zca-js's
 * ~145 methods. Browse the full catalog at `GET /methods` or via the API Explorer.
 */

const methodCatalogMd = groupedCatalog()
    .map(
        ({ category, methods }) =>
            `**${category}**\n\n` +
            methods.map((m) => `- \`${m.name}\``).join("\n"),
    )
    .join("\n\n");

const META_OK = {
    type: "object",
    properties: {
        ts: { type: "integer", description: "Server timestamp (ms)" },
        ms: { type: "integer", description: "Handler duration (ms)" },
    },
    required: ["ts"],
};

const META_ERR = {
    type: "object",
    properties: { ts: { type: "integer" } },
    required: ["ts"],
};

function envelopeOk(dataSchema: object) {
    return {
        type: "object",
        required: ["ok", "data", "meta"],
        properties: {
            ok: { type: "boolean", enum: [true] },
            data: dataSchema,
            meta: META_OK,
        },
    };
}

const ERR_RESPONSES = {
    "400": { description: "Validation or login error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErr" } } } },
    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErr" } } } },
    "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErr" } } } },
    "429": { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErr" } } } },
    "500": { description: "Internal error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErr" } } } },
    "502": { description: "Upstream Zalo error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErr" } } } },
};

function jsonOk(dataSchema: object, status = 200) {
    return {
        [String(status)]: {
            description: "Success",
            content: { "application/json": { schema: envelopeOk(dataSchema) } },
        },
    };
}

export const openapiSpec = {
    openapi: "3.0.3",
    info: {
        title: "zalo-auto API",
        version: "0.1.0",
        description:
            "REST API tự động hoá Zalo đa tài khoản, build trên thư viện không chính thức " +
            "[zca-js](https://zca-js.tdung.com).\n\n" +
            "## Envelope\n\n" +
            "**Mọi response dùng cùng một shape:**\n\n" +
            "```json\n" +
            "// thành công\n" +
            "{ \"ok\": true, \"data\": <T>, \"meta\": { \"ts\": 0, \"ms\": 0 } }\n\n" +
            "// thất bại\n" +
            "{ \"ok\": false, \"error\": { \"code\": \"NOT_FOUND\", \"message\": \"...\" }, \"meta\": { \"ts\": 0 } }\n" +
            "```\n\n" +
            "Error codes: `VALIDATION_ERROR (400)`, `LOGIN_FAILED (400)`, `UNAUTHORIZED (401)`, " +
            "`NOT_FOUND (404)`, `ZALO_ERROR (502)`, `INTERNAL_ERROR (500)`.\n\n" +
            "## ⚠️ Cảnh báo\n\n" +
            "zca-js là API không chính thức — Zalo có thể khoá tài khoản. Throttle, đừng spam.",
        contact: {
            name: "zca-js reference",
            url: "https://zca-js.tdung.com/vi/apis/",
        },
    },
    servers: [
        {
            url: config.API_PREFIX || "/",
            description: config.API_PREFIX
                ? `Same-origin, mounted under ${config.API_PREFIX}`
                : "Same-origin (no prefix)",
        },
    ],
    tags: [
        { name: "Admin", description: "Đăng nhập admin (UI cookie auth)" },
        { name: "Auth", description: "QR và token-based login (Zalo accounts)" },
        { name: "Accounts", description: "CRUD tài khoản đã lưu" },
        {
            name: "Quick Actions",
            description: "Wrapper tiện lợi: làm việc với số điện thoại thay vì uid.",
        },
        {
            name: "API Proxy",
            description: "Generic proxy onto bất kỳ method nào của zca-js (~145 methods).",
        },
        { name: "Catalog", description: "Danh sách method có sẵn + Vietnamese docs" },
        { name: "Health", description: "Kiểm tra server" },
    ],

    paths: {
        "/health": {
            get: {
                tags: ["Health"],
                summary: "Health check",
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            service: { type: "string" },
                            uptime: { type: "number" },
                        },
                    }),
                },
            },
        },

        // ------------ Admin ------------
        "/admin/login": {
            post: {
                tags: ["Admin"],
                summary: "Đăng nhập admin (UI dashboard)",
                description: "Set HTTP-only cookie session. Cookie hợp lệ → mọi request UI được auth.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["username", "password"],
                                properties: {
                                    username: { type: "string" },
                                    password: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            user: { type: "string" },
                            expiresAt: { type: "integer" },
                        },
                    }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/admin/logout": {
            post: {
                tags: ["Admin"],
                summary: "Đăng xuất admin",
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: { loggedOut: { type: "boolean" } },
                    }),
                },
            },
        },
        "/admin/me": {
            get: {
                tags: ["Admin"],
                summary: "Trạng thái session admin hiện tại",
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            authEnabled: { type: "boolean" },
                            user: { type: "string", nullable: true },
                            expiresAt: { type: "integer" },
                        },
                    }),
                    ...ERR_RESPONSES,
                },
            },
        },

        // ------------ Auth ------------
        "/auth/qr": {
            post: {
                tags: ["Auth"],
                summary: "Bắt đầu phiên đăng nhập QR",
                description:
                    "Tạo qr_session mới. Client phải poll `GET /auth/qr/{id}` để " +
                    "lấy QR data URL và theo dõi trạng thái.",
                responses: {
                    ...jsonOk(
                        {
                            type: "object",
                            properties: {
                                id: { type: "string", format: "uuid" },
                                status: { type: "string", example: "pending" },
                            },
                        },
                        201,
                    ),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/auth/qr/{id}": {
            get: {
                tags: ["Auth"],
                summary: "Poll trạng thái phiên QR",
                parameters: [
                    { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
                ],
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/QrSession" }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/auth/token": {
            post: {
                tags: ["Auth"],
                summary: "Đăng nhập bằng token export sẵn",
                description:
                    "Cho phép đăng nhập bằng `z_uuid` + `zpw_sek` đã export từ extension trình duyệt. " +
                    "Có thể nhập dạng base64 token (`{token}`) hoặc trực tiếp `{z_uuid, zpw_sek}`. " +
                    "Phone và displayName tuỳ chọn — nếu không cung cấp, server sẽ tự lấy từ Zalo.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/TokenLoginBody" },
                            examples: {
                                base64Token: {
                                    summary: "Bằng token base64",
                                    value: { token: "eyJ6X3V1aWQiOiI...", displayName: "Tên hiển thị", phone: "+84..." },
                                },
                                explicitFields: {
                                    summary: "Nhập trực tiếp",
                                    value: { z_uuid: "5eaf9d5e-...", zpw_sek: "ogNZ.444288373.a0..." },
                                },
                            },
                        },
                    },
                },
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/Account" }, 201),
                    ...ERR_RESPONSES,
                },
            },
        },

        // ------------ Accounts ------------
        "/accounts": {
            get: {
                tags: ["Accounts"],
                summary: "Liệt kê tài khoản đã lưu",
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            accounts: {
                                type: "array",
                                items: { $ref: "#/components/schemas/Account" },
                            },
                        },
                    }),
                },
            },
        },
        "/accounts/{id}": {
            get: {
                tags: ["Accounts"],
                summary: "Chi tiết tài khoản",
                parameters: [{ $ref: "#/components/parameters/AccountId" }],
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/Account" }),
                    ...ERR_RESPONSES,
                },
            },
            patch: {
                tags: ["Accounts"],
                summary: "Sửa display name / phone / status",
                parameters: [{ $ref: "#/components/parameters/AccountId" }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    phone: { type: "string", nullable: true },
                                    displayName: { type: "string", nullable: true },
                                    status: { type: "string", enum: ["active", "disabled"] },
                                },
                            },
                        },
                    },
                },
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/Account" }),
                    ...ERR_RESPONSES,
                },
            },
            delete: {
                tags: ["Accounts"],
                summary: "Xoá tài khoản và drop session khỏi pool",
                parameters: [{ $ref: "#/components/parameters/AccountId" }],
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            id: { type: "string", format: "uuid" },
                            deleted: { type: "boolean" },
                        },
                    }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/accounts/{id}/listener/start": {
            post: {
                tags: ["Accounts"],
                summary: "Bật listener — nhận event Zalo realtime",
                description:
                    "Set `listenerEnabled=true` rồi attach `api.listener` của zca-js. Mọi event " +
                    "(message, reaction, undo, group_event, friend_event, typing, ...) sẽ được " +
                    "phát ra:\n" +
                    "- WebSocket `ws://host/events` (subscribe theo accountId)\n" +
                    "- Webhook URL nếu đã config\n\n" +
                    "Listener tự resume sau khi server restart (nếu `listenerEnabled=true`).",
                parameters: [{ $ref: "#/components/parameters/AccountId" }],
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/Account" }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/accounts/{id}/listener/stop": {
            post: {
                tags: ["Accounts"],
                summary: "Tắt listener",
                parameters: [{ $ref: "#/components/parameters/AccountId" }],
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/Account" }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/accounts/{id}/refresh-token": {
            post: {
                tags: ["Accounts"],
                summary: "Cập nhật token / re-login cho tài khoản",
                description:
                    "Dùng khi token cũ hết hạn hoặc bị Zalo cut. Server thử login với token mới " +
                    "rồi thay credentials. Phone + displayName giữ nguyên (trừ khi token thuộc uid khác → tạo account mới).",
                parameters: [{ $ref: "#/components/parameters/AccountId" }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/TokenLoginBody" },
                        },
                    },
                },
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/Account" }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/accounts/{id}/check": {
            post: {
                tags: ["Accounts"],
                summary: "Ping session — kiểm tra có bị out không",
                description:
                    "Gọi `fetchAccountInfo()` để xác minh session còn sống. Trả `online: true` " +
                    "nếu OK, `online: false` (cùng `reason`) nếu bị out. Session hỏng sẽ bị drop khỏi pool. " +
                    "Đặt `?autoDisable=1` để tự đánh dấu account `disabled` khi out.",
                parameters: [
                    { $ref: "#/components/parameters/AccountId" },
                    {
                        name: "autoDisable",
                        in: "query",
                        required: false,
                        schema: { type: "string", enum: ["0", "1"] },
                    },
                ],
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            online: { type: "boolean" },
                            accountId: { type: "string", format: "uuid" },
                            uid: { type: "string" },
                            reason: { type: "string" },
                            profile: { type: "object" },
                            droppedAt: { type: "integer" },
                            autoDisabled: { type: "boolean" },
                        },
                    }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/accounts/{id}/credentials": {
            get: {
                tags: ["Accounts"],
                summary: "Lấy credentials đã giải mã (SENSITIVE)",
                parameters: [{ $ref: "#/components/parameters/AccountId" }],
                responses: {
                    ...jsonOk({
                        allOf: [
                            { $ref: "#/components/schemas/Account" },
                            {
                                type: "object",
                                properties: {
                                    credentials: { $ref: "#/components/schemas/StoredCredentials" },
                                },
                            },
                        ],
                    }),
                    ...ERR_RESPONSES,
                },
            },
        },

        // ------------ Quick Actions ------------
        "/quick/{accountId}/find-by-phone": {
            post: {
                tags: ["Quick Actions"],
                summary: "Tìm user theo số điện thoại",
                description:
                    "Tự động thử các định dạng: `0xxx`, `84xxx`, `+84xxx`. Trả về user object từ `findUser` của zca-js.",
                parameters: [
                    { name: "accountId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["phone"],
                                properties: { phone: { type: "string", example: "+84779174220" } },
                            },
                        },
                    },
                },
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            phone: { type: "string" },
                            user: {
                                type: "object",
                                properties: {
                                    uid: { type: "string" },
                                    display_name: { type: "string" },
                                    zalo_name: { type: "string" },
                                    avatar: { type: "string" },
                                    cover: { type: "string" },
                                    status: { type: "string" },
                                    gender: { type: "integer" },
                                    dob: { type: "integer" },
                                    sdob: { type: "string" },
                                    globalId: { type: "string" },
                                },
                            },
                        },
                    }),
                    ...ERR_RESPONSES,
                },
            },
        },
        "/quick/{accountId}/send-by-phone": {
            post: {
                tags: ["Quick Actions"],
                summary: "Gửi tin nhắn 1-1 theo số điện thoại",
                description:
                    "Backend gọi `findUser(phone)` rồi `sendMessage(message, uid, 0)`. " +
                    "`message` là string hoặc `MessageContent` object.",
                parameters: [
                    { name: "accountId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["phone", "message"],
                                properties: {
                                    phone: { type: "string", example: "+84779174220" },
                                    message: {
                                        oneOf: [{ type: "string" }, { type: "object" }],
                                        example: "Xin chào",
                                    },
                                },
                            },
                            examples: {
                                textMessage: {
                                    summary: "Tin text đơn giản",
                                    value: { phone: "+84779174220", message: "Xin chào từ zalo-auto" },
                                },
                                richMessage: {
                                    summary: "Tin styled",
                                    value: { phone: "+84779174220", message: { msg: "Hello", urgency: 1 } },
                                },
                            },
                        },
                    },
                },
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            phone: { type: "string" },
                            user: { type: "object" },
                            sendResult: { type: "object" },
                        },
                    }),
                    ...ERR_RESPONSES,
                },
            },
        },

        // ------------ API Proxy ------------
        "/api/{accountId}/{method}": {
            post: {
                tags: ["API Proxy"],
                summary: "Gọi bất kỳ method zca-js nào",
                description:
                    "Server tìm session đã đăng nhập theo `accountId`, sau đó gọi " +
                    "`api[method](...args)`. `args` là một mảng được spread vào method.\n\n" +
                    "### Catalog (~" +
                    METHOD_NAMES.length +
                    " methods)\n\n" +
                    methodCatalogMd +
                    "\n\nXem mô tả + signature đầy đủ tại `GET /methods/{name}`.",
                parameters: [
                    { name: "accountId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
                    {
                        name: "method",
                        in: "path",
                        required: true,
                        schema: { type: "string", enum: METHOD_NAMES },
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["args"],
                                properties: {
                                    args: { type: "array", items: {} },
                                },
                            },
                            examples: {
                                fetchAccountInfo: { summary: "fetchAccountInfo (no args)", value: { args: [] } },
                                getAllFriends: { summary: "getAllFriends", value: { args: [100, 1] } },
                                sendMessage: {
                                    summary: "sendMessage",
                                    value: { args: [{ msg: "Xin chào" }, "<userId>", 0] },
                                },
                            },
                        },
                    },
                },
                responses: {
                    ...jsonOk({ description: "Whatever the underlying zca-js method returns" }),
                    ...ERR_RESPONSES,
                },
            },
        },

        // ------------ Catalog ------------
        "/methods": {
            get: {
                tags: ["Catalog"],
                summary: "Catalog method (full doc + signature + examples)",
                responses: {
                    ...jsonOk({
                        type: "object",
                        properties: {
                            total: { type: "integer" },
                            groups: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        category: { type: "string" },
                                        methods: { type: "array", items: { $ref: "#/components/schemas/MethodDoc" } },
                                    },
                                },
                            },
                        },
                    }),
                },
            },
        },
        "/methods/{name}": {
            get: {
                tags: ["Catalog"],
                summary: "Doc 1 method cụ thể",
                parameters: [
                    { name: "name", in: "path", required: true, schema: { type: "string" } },
                ],
                responses: {
                    ...jsonOk({ $ref: "#/components/schemas/MethodDoc" }),
                    ...ERR_RESPONSES,
                },
            },
        },
    },

    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                description: "Set when API_KEY env is configured. Empty in dev = open mode.",
            },
            apiKeyHeader: {
                type: "apiKey",
                in: "header",
                name: "X-API-Key",
            },
        },
        parameters: {
            AccountId: {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string", format: "uuid" },
            },
        },
        schemas: {
            ApiErr: {
                type: "object",
                required: ["ok", "error", "meta"],
                properties: {
                    ok: { type: "boolean", enum: [false] },
                    error: {
                        type: "object",
                        required: ["code", "message"],
                        properties: {
                            code: {
                                type: "string",
                                enum: [
                                    "VALIDATION_ERROR",
                                    "NOT_FOUND",
                                    "UNAUTHORIZED",
                                    "RATE_LIMITED",
                                    "LOGIN_FAILED",
                                    "ZALO_ERROR",
                                    "INTERNAL_ERROR",
                                ],
                            },
                            message: { type: "string" },
                            issues: {},
                        },
                    },
                    meta: META_ERR,
                },
            },
            Account: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    uid: { type: "string", description: "Zalo user id" },
                    phone: { type: "string", nullable: true },
                    displayName: { type: "string", nullable: true },
                    imei: { type: "string", description: "Same as `z_uuid`" },
                    userAgent: { type: "string" },
                    language: { type: "string", example: "vi" },
                    status: { type: "string", enum: ["active", "disabled"] },
                    lastActiveAt: { type: "integer", nullable: true },
                    createdAt: { type: "integer" },
                    updatedAt: { type: "integer" },
                    listenerEnabled: { type: "boolean" },
                    webhookUrl: { type: "string", nullable: true },
                    webhookSecretSet: {
                        type: "boolean",
                        description: "True nếu có secret. Server không bao giờ trả secret.",
                    },
                },
            },
            StoredCredentials: {
                type: "object",
                properties: {
                    cookie: { type: "array", items: { type: "object" } },
                    imei: { type: "string" },
                    userAgent: { type: "string" },
                    language: { type: "string" },
                    secretKey: { type: "string", description: "= api_key" },
                    uid: { type: "string" },
                    cookieSnapshot: {
                        type: "object",
                        additionalProperties: { type: "string" },
                    },
                },
            },
            QrSession: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    status: { type: "string", enum: ["pending", "scanned", "success", "failed", "expired"] },
                    qrDataUrl: { type: "string", nullable: true },
                    accountId: { type: "string", format: "uuid", nullable: true },
                    error: { type: "string", nullable: true },
                    createdAt: { type: "integer" },
                    updatedAt: { type: "integer" },
                },
            },
            TokenLoginBody: {
                type: "object",
                properties: {
                    token: { type: "string", description: "base64 của `{ z_uuid, ZaloCookies }`" },
                    z_uuid: { type: "string" },
                    zpw_sek: { type: "string" },
                    userAgent: { type: "string" },
                    language: { type: "string" },
                    phone: { type: "string", nullable: true },
                    displayName: { type: "string", nullable: true },
                },
            },
            MethodDoc: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    category: { type: "string" },
                    description: { type: "string" },
                    notes: { type: "string", nullable: true },
                    params: { type: "string", description: "TypeScript params signature" },
                    returnType: { type: "string", description: "TypeScript return type" },
                    examples: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                summary: { type: "string" },
                                args: { type: "array", items: {} },
                            },
                        },
                    },
                    docUrl: { type: "string", format: "uri" },
                },
            },
        },
    },
};
