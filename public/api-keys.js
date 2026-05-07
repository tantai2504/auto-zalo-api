const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, kind = "info") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

async function api(path, opts = {}) {
    const res = await fetch(path, {
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

function fmtRelative(ts) {
    if (!ts) return "—";
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    const unit =
        abs < 60_000 ? `${Math.round(abs / 1000)}s` :
        abs < 3_600_000 ? `${Math.round(abs / 60_000)} phút` :
        abs < 86_400_000 ? `${Math.round(abs / 3_600_000)} giờ` :
        `${Math.round(abs / 86_400_000)} ngày`;
    return diff > 0 ? `còn ${unit}` : `đã ${unit}`;
}

function escapeHtml(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

// ----- Logout -----------------------------------------------------

$("#logoutBtn").addEventListener("click", async (ev) => {
    ev.preventDefault();
    try { await fetch("/admin/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    location.href = "/login.html";
});

// ----- Prefix display in usage box --------------------------------

const prefix = (window.ZALO_AUTO && window.ZALO_AUTO.apiPrefix) || "";
$("#prefixDemo").textContent = prefix;
$("#prefixDemo2").textContent = prefix;

// ----- Load list -------------------------------------------------

async function loadKeys() {
    try {
        const data = await api("/admin/api-keys");
        renderKeys(data.keys);
    } catch (err) {
        toast(err.message, "error");
    }
}

function renderKeys(keys) {
    const tbody = $("#keysTable tbody");
    tbody.innerHTML = "";
    $("#emptyHint").classList.toggle("hidden", keys.length > 0);
    for (const k of keys) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                <div class="contact-name">${escapeHtml(k.name)}</div>
                <div class="contact-phone">by ${escapeHtml(k.createdBy)}</div>
            </td>
            <td class="uid">${escapeHtml(k.keyPreview)}</td>
            <td><span class="badge ${k.status}">${k.status}</span></td>
            <td title="${k.expiresAt ? fmtDate(k.expiresAt) : 'Never'}">${
                k.expiresAt
                    ? `<div>${fmtDate(k.expiresAt)}</div><div class="contact-phone">${fmtRelative(k.expiresAt)}</div>`
                    : "—"
            }</td>
            <td>${fmtDate(k.lastUsedAt)}</td>
            <td>${fmtDate(k.createdAt)}</td>
            <td class="actions">
                <button class="danger" data-action="revoke" ${k.status === "revoked" ? "disabled" : ""}>Revoke</button>
            </td>
        `;
        tr.querySelector('[data-action="revoke"]').addEventListener("click", () => revokeKey(k));
        tbody.appendChild(tr);
    }
}

async function revokeKey(k) {
    if (!confirm(`Revoke key "${k.name}"? Hành động này không hoàn tác được.`)) return;
    try {
        await api(`/admin/api-keys/${k.id}`, { method: "DELETE" });
        toast("Đã revoke", "success");
        loadKeys();
    } catch (err) {
        toast(err.message, "error");
    }
}

// ----- Create modal ------------------------------------------------

$("#newKeyBtn").addEventListener("click", () => {
    $("#createForm").reset();
    $("#createModal").classList.remove("hidden");
});
$("#cancelCreate").addEventListener("click", () => $("#createModal").classList.add("hidden"));
$("#reloadBtn").addEventListener("click", loadKeys);

$("#createForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const body = {
        name: fd.get("name").toString().trim(),
        expiresInSec: Number(fd.get("expiresInSec") ?? 0),
    };
    if (!body.name) return toast("Cần nhập tên", "error");

    const btn = ev.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Đang tạo…";
    try {
        const result = await api("/admin/api-keys", {
            method: "POST",
            body: JSON.stringify(body),
        });
        $("#createModal").classList.add("hidden");
        showPlainKey(result.plainKey);
        loadKeys();
    } catch (err) {
        toast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Tạo key";
    }
});

// ----- Show key once ----------------------------------------------

let pendingKey = "";

function showPlainKey(key) {
    pendingKey = key;
    $("#plainKeyView").textContent = key;
    $("#showKeyModal").classList.remove("hidden");
}

$("#copyKeyBtn").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(pendingKey);
        toast("Đã copy key vào clipboard", "success");
    } catch {
        toast("Không copy được — chọn thủ công", "error");
    }
    $("#showKeyModal").classList.add("hidden");
    pendingKey = "";
});

// ----- Init --------------------------------------------------------

loadKeys();
