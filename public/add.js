// Shared helpers (small subset of app.js — kept here so add.html doesn't depend
// on the dashboard JS).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message, kind = "info") {
    const el = document.createElement("div");
    const palette = { info: "bg-slate-800", success: "bg-green-600", error: "bg-red-600" };
    el.className = `${palette[kind] ?? palette.info} text-white px-4 py-2 rounded-md shadow-lg text-sm pointer-events-auto animate-fadeIn`;
    el.textContent = message;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function apiUrl(path) {
    const prefix = (window.ZALO_AUTO && window.ZALO_AUTO.apiPrefix) || "";
    if (!prefix) return path;
    if (path.startsWith("/admin/")) return path;
    return prefix + path;
}

async function api(path, opts = {}) {
    const res = await fetch(apiUrl(path), {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...opts,
    });
    if (res.status === 401) {
        location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
        throw new Error("Phiên hết hạn — đang chuyển về trang đăng nhập");
    }
    if (res.status === 204) return null;
    let payload;
    try { payload = await res.json(); } catch { throw new Error(`HTTP ${res.status}`); }
    if (payload.ok === true) return payload.data;
    if (payload.ok === false) {
        const msg = payload.error?.message ?? `HTTP ${res.status}`;
        const err = new Error(msg);
        err.code = payload.error?.code;
        throw err;
    }
    throw new Error(`Unexpected response (HTTP ${res.status})`);
}

// ----- Logout -----------------------------------------------------

$("#logoutBtn")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try {
        await fetch("/admin/logout", { method: "POST", credentials: "same-origin" });
    } catch {}
    location.href = "/login.html";
});

// ----- Tabs -------------------------------------------------------

$$(".tab-trigger").forEach((tab) => {
    tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        $$(".tab-trigger").forEach((t) => {
            const active = t === tab;
            t.classList.toggle("border-primary-600", active);
            t.classList.toggle("text-primary-600", active);
            t.classList.toggle("border-transparent", !active);
            t.classList.toggle("text-slate-500", !active);
            t.classList.toggle("hover:text-slate-900", !active);
        });
        $$(".tab-panel").forEach((p) =>
            p.classList.toggle("hidden", p.dataset.panel !== target),
        );
    });
});

// ----- Token form -------------------------------------------------

$("#tokenForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    const body = {};
    const token = fd.get("token")?.toString().trim();
    const zUuid = fd.get("z_uuid")?.toString().trim();
    const zpwSek = fd.get("zpw_sek")?.toString().trim();
    const phone = fd.get("phone")?.toString().trim();
    const displayName = fd.get("displayName")?.toString().trim();

    if (token) body.token = token;
    if (zUuid) body.z_uuid = zUuid;
    if (zpwSek) body.zpw_sek = zpwSek;
    if (phone) body.phone = phone;
    if (displayName) body.displayName = displayName;

    if (!body.token && !(body.z_uuid && body.zpw_sek)) {
        toast("Cần Token hoặc cả z_uuid + zpw_sek", "error");
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Đang đăng nhập…";
    try {
        const account = await api("/auth/token", {
            method: "POST",
            body: JSON.stringify(body),
        });
        toast(`Đã thêm: ${account.displayName ?? account.uid}`, "success");
        setTimeout(() => (location.href = "/"), 800);
    } catch (err) {
        toast(err.message, "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Đăng nhập";
    }
});

// ----- QR login ---------------------------------------------------

let qrPollTimer = null;

$("#newQrBtn").addEventListener("click", async () => {
    if (qrPollTimer) {
        clearInterval(qrPollTimer);
        qrPollTimer = null;
    }
    const btn = $("#newQrBtn");
    btn.disabled = true;
    btn.textContent = "Đang tạo…";
    try {
        const session = await api("/auth/qr", { method: "POST" });
        $("#qrBox").classList.remove("hidden");
        $("#qrStatus").textContent = session.status;
        $("#qrImg").src = "";
        pollQr(session.id);
    } catch (err) {
        toast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Tạo QR mới";
    }
});

async function pollQr(id) {
    const check = async () => {
        try {
            const s = await api(`/auth/qr/${id}`);
            $("#qrStatus").textContent = s.status;
            if (s.qrDataUrl) $("#qrImg").src = s.qrDataUrl;
            if (["success", "failed", "expired"].includes(s.status)) {
                clearInterval(qrPollTimer);
                qrPollTimer = null;
                if (s.status === "success") {
                    toast("Đăng nhập QR thành công", "success");
                    setTimeout(() => (location.href = "/"), 1000);
                } else if (s.error) {
                    toast(s.error, "error");
                }
            }
        } catch (err) {
            clearInterval(qrPollTimer);
            qrPollTimer = null;
            toast(err.message, "error");
        }
    };
    await check();
    qrPollTimer = setInterval(check, 1500);
}
