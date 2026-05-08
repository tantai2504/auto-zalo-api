const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, kind = "info") {
    const el = document.createElement("div");
    const palette = { info: "bg-slate-800", success: "bg-green-600", error: "bg-red-600" };
    el.className = `${palette[kind] ?? palette.info} text-white px-4 py-2 rounded-md shadow-lg text-sm pointer-events-auto animate-fadeIn`;
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
    const statusColor = {
        active: "bg-green-100 text-green-700",
        expired: "bg-amber-100 text-amber-700",
        revoked: "bg-red-100 text-red-700",
    };
    for (const k of keys) {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 transition-colors";
        const dangerCls = k.status === "revoked"
            ? "px-3 py-1 text-xs bg-slate-200 text-slate-400 rounded cursor-not-allowed"
            : "px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors";
        tr.innerHTML = `
            <td class="px-4 py-3">
                <div class="font-medium text-slate-900">${escapeHtml(k.name)}</div>
                <div class="text-xs text-slate-500 mt-0.5">by ${escapeHtml(k.createdBy)}</div>
            </td>
            <td class="px-4 py-3 font-mono text-xs text-slate-600">${escapeHtml(k.keyPreview)}</td>
            <td class="px-4 py-3"><span class="${statusColor[k.status] ?? "bg-slate-100 text-slate-500"} px-2 py-0.5 rounded text-xs font-semibold uppercase">${k.status}</span></td>
            <td class="px-4 py-3 text-xs">${
                k.expiresAt
                    ? `<div class="text-slate-700">${fmtDate(k.expiresAt)}</div><div class="text-slate-500">${fmtRelative(k.expiresAt)}</div>`
                    : '<span class="text-slate-400">—</span>'
            }</td>
            <td class="px-4 py-3 text-xs text-slate-600">${fmtDate(k.lastUsedAt)}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${fmtDate(k.createdAt)}</td>
            <td class="px-4 py-3 text-right">
                <button class="${dangerCls}" data-action="revoke" ${k.status === "revoked" ? "disabled" : ""}>Revoke</button>
            </td>
        `;
        const btn = tr.querySelector('[data-action="revoke"]');
        if (btn && !btn.disabled) btn.addEventListener("click", () => revokeKey(k));
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
