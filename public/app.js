const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message, kind = "info") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = message;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

/**
 * Prepend the configured API_PREFIX (`window.ZALO_AUTO.apiPrefix`) to data
 * API paths. /admin/* paths stay at root because admin auth is intentionally
 * un-versioned.
 */
function apiUrl(path) {
    const prefix = (window.ZALO_AUTO && window.ZALO_AUTO.apiPrefix) || "";
    if (!prefix) return path;
    if (path.startsWith("/admin/")) return path;
    return prefix + path;
}

/** Envelope-aware fetch wrapper. Redirects to /login.html on 401. */
async function api(path, opts = {}) {
    const res = await fetch(apiUrl(path), {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...opts,
    });
    if (res.status === 401) {
        location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
        throw new Error("Phiên hết hạn");
    }
    if (res.status === 204) return null;
    let payload;
    try { payload = await res.json(); } catch { throw new Error(`HTTP ${res.status}`); }
    if (payload.ok === true) return payload.data;
    if (payload.ok === false) {
        const issues = payload.error?.issues;
        const msg =
            payload.error?.message ??
            (Array.isArray(issues) ? issues.map((i) => i.message ?? JSON.stringify(i)).join("; ") : `HTTP ${res.status}`);
        const err = new Error(msg);
        err.code = payload.error?.code;
        throw err;
    }
    throw new Error(`Unexpected response (HTTP ${res.status})`);
}

function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("vi-VN");
}

function shortUid(uid) {
    if (!uid) return "—";
    return uid.length > 14 ? uid.slice(0, 8) + "…" + uid.slice(-4) : uid;
}

function escapeHtml(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

// Track session-state per account (online/offline/unknown), updated by check()
const sessionState = new Map(); // accountId → "online" | "offline" | "checking" | "unknown"

// ----- Logout -----------------------------------------------------

$("#logoutBtn")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try {
        await fetch("/admin/logout", { method: "POST", credentials: "same-origin" });
    } catch {}
    location.href = "/login.html";
});

// ----- Accounts list -----------------------------------------------

$("#reloadBtn").addEventListener("click", () => loadAccounts());
$("#checkAllBtn").addEventListener("click", () => checkAllAccounts());

async function loadAccounts() {
    try {
        const data = await api("/accounts");
        renderAccounts(data.accounts);
    } catch (err) {
        toast(err.message, "error");
    }
}

function sessionBadge(accountId) {
    const s = sessionState.get(accountId) ?? "unknown";
    const label = {
        online: "online",
        offline: "offline",
        checking: "checking…",
        unknown: "—",
    }[s];
    return `<span class="badge session-${s}">${label}</span>`;
}

function renderAccounts(accounts) {
    const tbody = $("#accountsTable tbody");
    tbody.innerHTML = "";
    $("#emptyHint").classList.toggle("hidden", accounts.length > 0);
    for (const acc of accounts) {
        const tr = document.createElement("tr");
        tr.dataset.id = acc.id;
        tr.innerHTML = `
            <td class="contact-cell">
                <div class="contact-name">${escapeHtml(acc.displayName ?? "—")}</div>
                <div class="contact-phone">${escapeHtml(acc.phone ?? "—")}</div>
            </td>
            <td class="uid">
                <button class="copy-id" data-action="copy-id" title="Click để copy: ${escapeHtml(acc.id)}">
                    <span class="copy-text">${escapeHtml(shortUid(acc.id))}</span>
                    <span class="copy-icon">⧉</span>
                </button>
            </td>
            <td class="uid" title="${escapeHtml(acc.uid)}">${escapeHtml(shortUid(acc.uid))}</td>
            <td><span class="badge ${acc.status}">${acc.status}</span></td>
            <td class="session-cell">${sessionBadge(acc.id)}</td>
            <td class="actions">
                <button class="ghost" data-action="check" title="Kiểm tra session">Check</button>
                <button class="ghost" data-action="cookie" title="Xem cookie session">Cookie</button>
                <button class="ghost" data-action="edit" title="Sửa thông tin / token / event">Sửa</button>
                <button class="ghost" data-action="toggle" title="${acc.status === "active" ? "Tắt tài khoản" : "Bật tài khoản"}">${acc.status === "active" ? "Tắt" : "Bật"}</button>
                <button class="danger" data-action="del" title="Xoá">Xoá</button>
            </td>
        `;
        tr.querySelector('[data-action="check"]').addEventListener("click", () => checkAcc(acc));
        tr.querySelector('[data-action="cookie"]').addEventListener("click", () => openCookie(acc));
        tr.querySelector('[data-action="edit"]').addEventListener("click", () => openEdit(acc));
        tr.querySelector('[data-action="toggle"]').addEventListener("click", () => toggleAcc(acc));
        tr.querySelector('[data-action="del"]').addEventListener("click", () => deleteAcc(acc));
        tr.querySelector('[data-action="copy-id"]').addEventListener("click", () =>
            copyId(acc.id),
        );
        tbody.appendChild(tr);
    }
}

async function copyId(id) {
    try {
        await navigator.clipboard.writeText(id);
        toast(`Đã copy: ${id}`, "success");
    } catch {
        // Fallback for older browsers / non-HTTPS
        const ta = document.createElement("textarea");
        ta.value = id;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); toast(`Đã copy: ${id}`, "success"); }
        catch { toast("Không copy được — chọn thủ công", "error"); }
        ta.remove();
    }
}

function updateSessionCell(accountId) {
    const tr = $(`tr[data-id="${accountId}"]`);
    if (!tr) return;
    const cell = tr.querySelector(".session-cell");
    if (cell) cell.innerHTML = sessionBadge(accountId);
}

// ----- Check session ---------------------------------------------

async function checkAcc(acc) {
    sessionState.set(acc.id, "checking");
    updateSessionCell(acc.id);
    try {
        const data = await api(`/accounts/${acc.id}/check`, { method: "POST" });
        sessionState.set(acc.id, data.online ? "online" : "offline");
        updateSessionCell(acc.id);
        if (data.online) {
            toast(`${acc.displayName ?? acc.uid}: session OK`, "success");
        } else {
            toast(`${acc.displayName ?? acc.uid} bị out: ${data.reason}`, "error");
        }
    } catch (err) {
        sessionState.set(acc.id, "unknown");
        updateSessionCell(acc.id);
        toast(err.message, "error");
    }
}

async function checkAllAccounts() {
    const trs = $$("#accountsTable tbody tr");
    const ids = trs.map((tr) => tr.dataset.id).filter(Boolean);
    let online = 0;
    let offline = 0;
    for (const id of ids) {
        sessionState.set(id, "checking");
        updateSessionCell(id);
        try {
            const data = await api(`/accounts/${id}/check`, { method: "POST" });
            sessionState.set(id, data.online ? "online" : "offline");
            data.online ? online++ : offline++;
        } catch {
            sessionState.set(id, "unknown");
        }
        updateSessionCell(id);
    }
    toast(`Đã check ${ids.length}: ${online} online, ${offline} offline`, online === ids.length ? "success" : "info");
}

// ----- Toggle status (active <→ disabled) ------------------------

async function toggleAcc(acc) {
    const next = acc.status === "active" ? "disabled" : "active";
    try {
        await api(`/accounts/${acc.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: next }),
        });
        toast(`Đã ${next === "active" ? "bật" : "tắt"} tài khoản`, "success");
        loadAccounts();
    } catch (err) {
        toast(err.message, "error");
    }
}

// ----- Delete -----------------------------------------------------

async function deleteAcc(acc) {
    if (!confirm(`Xoá tài khoản ${acc.displayName ?? acc.uid}?`)) return;
    try {
        await api(`/accounts/${acc.id}`, { method: "DELETE" });
        toast("Đã xoá", "success");
        loadAccounts();
    } catch (err) {
        toast(err.message, "error");
    }
}

// ----- Edit modal ------------------------------------------------

// Currently-open account in the edit modal (used by listener toggle in Event tab).
let editingAcc = null;

function openEdit(acc) {
    editingAcc = acc;
    $("#editTitle").textContent = `Sửa: ${acc.displayName ?? acc.uid}`;

    // Info tab
    const infoForm = $("#editForm");
    infoForm.id.value = acc.id;
    infoForm.displayName.value = acc.displayName ?? "";
    infoForm.phone.value = acc.phone ?? "";
    infoForm.status.value = acc.status;

    // Token tab
    const tokenForm = $("#refreshTokenForm");
    tokenForm.id.value = acc.id;
    tokenForm.token.value = "";
    tokenForm.z_uuid.value = "";
    tokenForm.zpw_sek.value = "";

    // Event tab — listener badge + webhook form
    renderListenerToggle(acc);
    const webhookForm = $("#webhookForm");
    webhookForm.id.value = acc.id;
    webhookForm.webhookUrl.value = acc.webhookUrl ?? "";
    webhookForm.webhookSecret.value = "";
    webhookForm.webhookSecret.placeholder = acc.webhookSecretSet
        ? "(đã set — để trống nếu không đổi, paste 'null' để xoá)"
        : "Để trống nếu không cần ký";

    // Reset to info tab
    switchEditTab("info");
    $("#modal").classList.remove("hidden");
}

function renderListenerToggle(acc) {
    const badge = $("#listenerBadge");
    const btn = $("#listenerToggleBtn");
    if (acc.listenerEnabled) {
        badge.className = "badge listener-on";
        badge.textContent = "ON";
        btn.textContent = "Tắt listener";
    } else {
        badge.className = "badge listener-off";
        badge.textContent = "OFF";
        btn.textContent = "Bật listener";
    }
}

$("#listenerToggleBtn").addEventListener("click", async () => {
    if (!editingAcc) return;
    const url = editingAcc.listenerEnabled
        ? `/accounts/${editingAcc.id}/listener/stop`
        : `/accounts/${editingAcc.id}/listener/start`;
    const btn = $("#listenerToggleBtn");
    btn.disabled = true;
    try {
        const updated = await api(url, { method: "POST" });
        editingAcc = updated;
        renderListenerToggle(updated);
        toast(`Listener ${updated.listenerEnabled ? "đã bật" : "đã tắt"}`, "success");
        loadAccounts();
    } catch (err) {
        toast(err.message, "error");
    } finally {
        btn.disabled = false;
    }
});

// ----- Cookie viewer modal -----------------------------------------

async function openCookie(acc) {
    $("#cookieAcc").textContent = acc.displayName ?? acc.uid;
    $("#cookieSnapshot").textContent = "Đang tải…";
    $("#cookieFull").textContent = "Đang tải…";
    $("#cookieModal").classList.remove("hidden");
    try {
        const data = await api(`/accounts/${acc.id}/credentials`);
        const c = data.credentials;
        const snapshot = c.cookieSnapshot ?? {};
        $("#cookieSnapshot").textContent = JSON.stringify({
            zpw_sek: snapshot.zpw_sek ?? "(không có)",
            zpw_enk: snapshot.zpw_enk ?? "(không có)",
            app: snapshot.app ?? "(không có)",
            imei: c.imei,
            uid: c.uid,
            secretKey: c.secretKey,
            userAgent: c.userAgent,
        }, null, 2);
        $("#cookieFull").textContent = JSON.stringify(c, null, 2);
        $("#copyCookieBtn").dataset.payload = JSON.stringify(c, null, 2);
        $("#copyZpwSekBtn").dataset.payload = snapshot.zpw_sek ?? "";
    } catch (err) {
        $("#cookieSnapshot").textContent = `Lỗi: ${err.message}`;
        $("#cookieFull").textContent = "";
    }
}

$("#cancelCookie").addEventListener("click", () => $("#cookieModal").classList.add("hidden"));

$("#copyCookieBtn").addEventListener("click", async () => {
    const payload = $("#copyCookieBtn").dataset.payload ?? "";
    try {
        await navigator.clipboard.writeText(payload);
        toast("Đã copy full credentials", "success");
    } catch {
        toast("Không copy được", "error");
    }
});

$("#copyZpwSekBtn").addEventListener("click", async () => {
    const payload = $("#copyZpwSekBtn").dataset.payload ?? "";
    if (!payload) return toast("Account chưa có zpw_sek", "error");
    try {
        await navigator.clipboard.writeText(payload);
        toast("Đã copy zpw_sek", "success");
    } catch {
        toast("Không copy được", "error");
    }
});

function switchEditTab(name) {
    $$("[data-edit-tab]").forEach((t) =>
        t.classList.toggle("active", t.dataset.editTab === name),
    );
    $$("[data-edit-panel]").forEach((p) =>
        p.classList.toggle("hidden", p.dataset.editPanel !== name),
    );
}

$$("[data-edit-tab]").forEach((t) =>
    t.addEventListener("click", () => switchEditTab(t.dataset.editTab)),
);

$("#cancelEdit").addEventListener("click", () => $("#modal").classList.add("hidden"));

$("#editForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const id = form.id.value;
    const body = {
        displayName: form.displayName.value.trim() || null,
        phone: form.phone.value.trim() || null,
        status: form.status.value,
    };
    try {
        await api(`/accounts/${id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
        });
        toast("Đã lưu", "success");
        $("#modal").classList.add("hidden");
        loadAccounts();
    } catch (err) {
        toast(err.message, "error");
    }
});

$("#refreshTokenForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const id = form.id.value;
    const body = {};
    const token = form.token.value.trim();
    const zUuid = form.z_uuid.value.trim();
    const zpwSek = form.zpw_sek.value.trim();
    if (token) body.token = token;
    if (zUuid) body.z_uuid = zUuid;
    if (zpwSek) body.zpw_sek = zpwSek;
    if (!body.token && !(body.z_uuid && body.zpw_sek)) {
        return toast("Cần Token hoặc cả z_uuid + zpw_sek", "error");
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Đang đăng nhập…";
    try {
        const updated = await api(`/accounts/${id}/refresh-token`, {
            method: "POST",
            body: JSON.stringify(body),
        });
        toast(`Đã cập nhật token cho ${updated.displayName ?? updated.uid}`, "success");
        $("#modal").classList.add("hidden");
        loadAccounts();
    } catch (err) {
        toast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Cập nhật token";
    }
});

$("#webhookForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const id = form.id.value;
    const body = {};
    const url = form.webhookUrl.value.trim();
    body.webhookUrl = url || null;
    const sec = form.webhookSecret.value;
    if (sec === "null") body.webhookSecret = null;
    else if (sec) body.webhookSecret = sec;
    // (omit when blank → server keeps existing secret)

    try {
        await api(`/accounts/${id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
        });
        toast("Đã lưu webhook config", "success");
        $("#modal").classList.add("hidden");
        loadAccounts();
    } catch (err) {
        toast(err.message, "error");
    }
});

// ----- Init --------------------------------------------------------

loadAccounts();
