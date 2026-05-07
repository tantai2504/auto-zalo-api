# zalo-auto

Multi-account Zalo automation backend built on the unofficial [`zca-js`](https://zca-js.tdung.com) library.

> ⚠️ **zca-js là API không chính thức.** Zalo có thể khoá tài khoản nếu phát hiện. Throttle request và đừng spam.

## Tính năng

- Đăng nhập nhiều tài khoản qua **QR** hoặc **token export sẵn**
- Lưu credentials đã mã hoá AES-256-GCM trong MongoDB
- REST API thống nhất với envelope `{ ok, data, error, meta }`
- Generic proxy `POST /api/{accountId}/{method}` gọi được mọi method trong ~145 method của zca-js
- Quick Actions: tìm/gửi tin theo **số điện thoại** (không cần biết uid trước)
- **Production hardening sẵn:** API key auth, rate limit, helmet, compression, CORS, keepAlive scheduler, real health check
- Swagger UI tại `/docs`, catalog method có docs tiếng Việt + signature TypeScript thật
- API Explorer JSON-driven tại `/explorer.html`

## Stack

| Concern        | Choice                                            |
| -------------- | ------------------------------------------------- |
| Runtime        | Node.js 24                                        |
| Language       | TypeScript (ESM)                                  |
| HTTP           | Express + Zod + helmet + compression + cors + rate-limit |
| Database       | MongoDB (Atlas hoặc self-hosted)                  |
| Logging        | Pino                                              |
| Zalo client    | `zca-js` v2.1.2                                   |
| Encryption     | AES-256-GCM                                       |

## Response envelope

**Mọi endpoint trả về cùng một shape.**

Thành công:
```json
{ "ok": true, "data": { ... }, "meta": { "ts": 1735000000000, "ms": 142 } }
```

Thất bại:
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "..." }, "meta": { "ts": 1735000000000 } }
```

| `error.code`        | HTTP status |
| ------------------- | ----------- |
| `VALIDATION_ERROR`  | 400         |
| `LOGIN_FAILED`      | 400         |
| `UNAUTHORIZED`      | 401         |
| `NOT_FOUND`         | 404         |
| `RATE_LIMITED`      | 429         |
| `INTERNAL_ERROR`    | 500         |
| `ZALO_ERROR`        | 502         |

## Endpoints

| Endpoint                                          | Auth | Mục đích                                  |
| ------------------------------------------------- | ---- | ----------------------------------------- |
| `GET  /health`                                    | —    | Health + Mongo ping + pool size            |
| `POST /admin/login`                               | —    | Đăng nhập admin (UI cookie session)        |
| `POST /admin/logout` + `GET /admin/me`            | —    | Logout / whoami                            |
| `POST /auth/qr` + `GET /auth/qr/{id}`             | ✅   | Đăng nhập 1 tài khoản Zalo bằng QR         |
| `POST /auth/token`                                | ✅   | Đăng nhập bằng z_uuid + zpw_sek            |
| `GET  /accounts`                                  | ✅   | Liệt kê account                            |
| `GET/PATCH/DELETE /accounts/{id}`                 | ✅   | CRUD account                               |
| `POST /accounts/{id}/refresh-token`               | ✅   | Cập nhật token (re-login giữ chỗ)          |
| `POST /accounts/{id}/check`                       | ✅   | Ping session — phát hiện bị out            |
| `POST /accounts/{id}/listener/start`              | ✅   | Bật listener nhận event realtime           |
| `POST /accounts/{id}/listener/stop`               | ✅   | Tắt listener                               |
| `WS   /events`                                    | ✅   | WebSocket realtime stream (xem dưới)       |
| `GET  /accounts/{id}/credentials`                 | ✅   | Credentials đã giải mã (SENSITIVE)         |
| `POST /quick/{accountId}/find-by-phone`           | ✅   | Tìm user theo SĐT                          |
| `POST /quick/{accountId}/send-by-phone`           | ✅   | Gửi tin 1-1 theo SĐT                       |
| `POST /api/{accountId}/{method}`                  | ✅   | Gọi bất kỳ method zca-js nào               |
| `GET  /methods` + `GET /methods/{name}`           | ✅   | Catalog + doc tiếng Việt                   |
| `GET  /docs`                                      | —    | Swagger UI                                 |
| `GET  /openapi.json`                              | —    | OpenAPI spec (cached 1h)                   |
| `GET  /login.html` `/add.html` `/` `/explorer.html` | —  | UI                                         |

✅ = cần **admin cookie session** (đăng nhập tại `/login.html`) **HOẶC** `Authorization: Bearer <API_KEY>`.
Nếu không config `ADMIN_USERNAME`+`ADMIN_PASSWORD` lẫn `API_KEY` → mọi endpoint đều mở (dev mode).

## Configuration (`.env`)

| Variable                  | Default                       | Mô tả                                        |
| ------------------------- | ----------------------------- | -------------------------------------------- |
| `PORT`                    | `3000`                        |                                              |
| `HOST`                    | `0.0.0.0`                     |                                              |
| `MONGO_URI`               | `mongodb://localhost:27017`   | Atlas hoặc self-hosted                       |
| `MONGO_DB`                | `zalo_auto`                   |                                              |
| `ENCRYPTION_KEY`          | **required**                  | 32-byte hex (mã hoá credentials)             |
| `API_KEY`                 | _(empty)_                     | Bearer/X-API-Key cho programmatic access     |
| `ADMIN_USERNAME`          | _(empty)_                     | Bật cookie auth cho UI nếu set cùng password |
| `ADMIN_PASSWORD`          | _(empty)_                     | Mật khẩu admin                                |
| `SESSION_SECRET`          | _(empty)_                     | 32-byte hex để ký cookie session              |
| `SESSION_TTL_SEC`         | `604800` (7 ngày)             | Cookie lifetime                               |
| `CORS_ORIGINS`            | _(empty)_                     | Comma-separated, hoặc `*`                    |
| `RATE_LIMIT_MAX`          | `120`                         | Per-IP / window. `0` để tắt                  |
| `RATE_LIMIT_WINDOW_SEC`   | `60`                          |                                              |
| `KEEPALIVE_INTERVAL_SEC`  | `240`                         | Background ping Zalo session. `0` tắt        |
| `LOG_LEVEL`               | `info`                        | `fatal/error/warn/info/debug/trace`          |

## Run locally (dev)

```sh
npm install
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # → ENCRYPTION_KEY
cp .env.example .env                                                        # paste key vào
# Start MongoDB (Laragon đã có sẵn)
npm run dev
```

UI: <http://localhost:3000/>

## Deploy lên cPanel (Setup Node.js App)

cPanel tự lo Phusion Passenger + restart, bạn chỉ cần upload code.

### 1. Upload source

- Zip toàn bộ project **trừ** `node_modules/`, `data/`, `.env`, `dist/`
- Upload qua File Manager vào ví dụ `/home/<user>/zalo-auto/`
- Giải nén tại đó

### 2. Setup Node.js App trong cPanel

Vào **Setup Node.js App** → **CREATE APPLICATION**:

| Field                  | Value                                       |
| ---------------------- | ------------------------------------------- |
| Node.js version        | **22.x hoặc 24.x** (chọn cao nhất có)       |
| Application mode       | Production                                  |
| Application root       | `zalo-auto`                                 |
| Application URL        | `api.yourdomain.com` (hoặc subdir)          |
| Application startup file | `dist/server.js`                          |

Bấm **CREATE**.

### 3. Set Environment Variables

Trong cùng panel, mục **Environment variables**, thêm các key từ `.env.example`. Tối thiểu:

```
ENCRYPTION_KEY=<32 byte hex>
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net   # MongoDB Atlas free tier hoặc tự host
MONGO_DB=zalo_auto
API_KEY=<random string khoẻ>                            # khuyến nghị bật cho production
NODE_ENV=production
```

**Không** commit `.env` lên repo. Để cPanel quản key qua UI.

### 4. Cài deps + build

Vào panel **Run NPM Install**, hoặc mở Terminal trong cPanel rồi:

```sh
cd ~/zalo-auto
source /home/<user>/nodevenv/zalo-auto/24/bin/activate     # đường dẫn cPanel show ra
npm install
npm run build
```

### 5. Restart

Bấm **RESTART** trong panel. Test:

```sh
curl https://api.yourdomain.com/health
# {"ok":true,"data":{"service":"zalo-auto","db":"up",...},"meta":{"ts":...}}
```

### 6. Update / re-deploy

Mỗi lần update code:
```sh
cd ~/zalo-auto
git pull             # hoặc upload file mới
npm install
npm run build
# vào panel cPanel bấm RESTART
```

Hoặc tạo file `.htaccess` trong `~/zalo-auto/tmp/restart.txt` để Phusion auto-reload (touch file là restart).

### MongoDB cho cPanel

cPanel hosting thường không cài sẵn MongoDB. 2 cách:

1. **MongoDB Atlas** (khuyến nghị) — free tier 512MB, đủ cho hàng chục nghìn account. Tạo cluster → lấy URI connection → set `MONGO_URI`.
2. **Self-host** — nếu hosting của bạn cho SSH + cài binary, hoặc thuê thêm VPS riêng cho MongoDB.

## Production checklist

- [ ] Set `API_KEY` trong env (bật bearer auth cho mọi non-public endpoint)
- [ ] Backup `ENCRYPTION_KEY` ngoài server. Mất key → toàn bộ credentials thành rác.
- [ ] MongoDB phải có authentication (`mongodb://user:pass@host/?authSource=admin` hoặc Atlas)
- [ ] cPanel sẽ tự đặt SSL qua AutoSSL — kiểm tra HTTPS hoạt động
- [ ] Set `CORS_ORIGINS` cho frontend domain (đừng để `*` nếu API có data nhạy cảm)
- [ ] Tweak `RATE_LIMIT_MAX` theo lượng tải dự kiến
- [ ] Monitor `GET /health` — set up uptime check (UptimeRobot, BetterStack, etc.)
- [ ] Log rotation tự động (cPanel thường handle qua Phusion log)

## Realtime events (Listener + WebSocket + Webhook)

zca-js có sẵn `Listener` phát event realtime (message, reaction, undo, group_event, ...).
zalo-auto wire 3 lớp xung quanh:

### 1. Bật/tắt listener cho từng tài khoản

```sh
curl -X POST -H "X-API-Key: $KEY" https://your.host/accounts/<id>/listener/start
curl -X POST -H "X-API-Key: $KEY" https://your.host/accounts/<id>/listener/stop
```

Trạng thái lưu vào DB. Khi server restart, mọi account có `listenerEnabled=true` tự được resume.

### 2. WebSocket realtime stream — `WS /events`

```js
const ws = new WebSocket("wss://your.host/events");
ws.onopen = () => ws.send(JSON.stringify({ action: "subscribe", accountId: "<uuid>" }));
ws.onmessage = (e) => {
  const payload = JSON.parse(e.data);
  // { wrapper: "event", event: { accountId, type, ts, data } }
};
```

Auth: cookie hoặc `?api_key=<key>` (browser không gắn được header tuỳ ý cho WS).
Subscribe `"all"` hoặc `"*"` để theo dõi mọi account.

UI sẵn có ở [`/events.html`](public/events.html).

### 3. Webhook — POST event vào URL của bạn

```sh
curl -X PATCH -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://your-server.com/zalo","webhookSecret":"hex-secret"}' \
  https://your.host/accounts/<id>
```

Server POST mỗi event tới `webhookUrl`:

```http
POST /your-handler HTTP/1.1
Content-Type: application/json
X-Event-Type: message
X-Account-Id: <uuid>
X-Signature: sha256=<hmac-hex>     (chỉ có khi webhookSecret set)

{ "accountId": "...", "uid": "...", "type": "message", "ts": 0, "data": { ... } }
```

Verify chữ ký Node.js:
```ts
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
if (!timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) reject();
```

Retry: 1 lần nếu 5xx hoặc timeout (8s). 4xx → không retry.

### Event types được forward

| Type | Mô tả |
|---|---|
| `message` | Tin nhắn mới |
| `reaction` | Reaction emoji |
| `undo` | Thu hồi tin nhắn |
| `group_event` | Sự kiện nhóm (thêm/đuổi member, đổi tên, ...) |
| `friend_event` | Sự kiện liên quan friend |
| `typing` | Đang nhập |
| `seen_messages` / `delivered_messages` | Tin đã xem / đã giao |
| `upload_attachment` | Attachment upload xong |
| `connected` / `disconnected` / `closed` / `error` | Trạng thái session |

## Performance defaults

- **gzip compression** — bật mặc định, giảm 60-80% bandwidth cho JSON response
- **Cache-Control** — `/methods` cache 5 phút, `/openapi.json` 1 giờ (nội dung không đổi runtime)
- **Background keepAlive** — mỗi 4 phút ping `keepAlive()` cho mọi session đang sống → Zalo không cut session
- **Session pool** — sessions tồn tại trong memory, khởi tạo lazy lần đầu (~300-500ms), về sau hit nóng (~50ms)
- **trust proxy: 1** — đọc đúng client IP từ Phusion / nginx cho rate-limit

## Project layout

```
src/
├── server.ts                # Express bootstrap + middleware wiring
├── config.ts                # Zod-validated env
├── logger.ts
├── http/
│   ├── response.ts          # Envelope helpers
│   ├── auth.ts              # Bearer / API key middleware
│   └── middleware.ts        # helmet, compression, cors, rate-limit
├── crypto/encrypt.ts        # AES-256-GCM
├── db/
│   ├── index.ts             # Mongo client + ping + indexes
│   ├── accounts.ts
│   └── qrSessions.ts
├── zalo/
│   ├── manager.ts           # Session pool + keepAlive scheduler
│   ├── qrLogin.ts
│   ├── tokenLogin.ts
│   ├── contacts.ts          # findByPhone, sendByPhone helpers
│   ├── extract.ts
│   ├── methodCatalog.ts
│   ├── methodDocs.ts        # Vietnamese docs + examples
│   ├── parseSignatures.ts   # Parse zca-js .d.ts → real signatures
│   └── types.ts
├── routes/
│   ├── auth.ts              # /auth/qr + /auth/token
│   ├── accounts.ts
│   ├── quick.ts
│   ├── api.ts
│   └── methods.ts
└── openapi.ts

public/
├── index.html  + app.js     # Account management UI
├── explorer.html + .js      # API Explorer
└── styles.css + explorer.css
```
