const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ACC_STORAGE = "zaloAutoSelectedAcc";

function toast(msg, kind = "info") {
    const el = document.createElement("div");
    const palette = { info: "bg-slate-800", success: "bg-green-600", error: "bg-red-600" };
    el.className = `${palette[kind] ?? palette.info} text-white px-4 py-2 rounded-md shadow-lg text-sm pointer-events-auto animate-fadeIn`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function escapeHtml(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

function apiUrl(path) {
    const prefix = (window.ZALO_AUTO && window.ZALO_AUTO.apiPrefix) || "";
    if (!prefix) return path;
    if (path.startsWith("/admin/")) return path;
    return prefix + path;
}

async function callApi(path, opts = {}) {
    const res = await fetch(apiUrl(path), {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...opts,
    });
    if (res.status === 401) {
        location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
        throw new Error("Phiên hết hạn");
    }
    const env = await res.json();
    if (!env.ok) throw new Error(env.error?.message ?? `HTTP ${res.status}`);
    return env.data;
}

const CATEGORY_VI = {
    Messaging: { label: "Nhắn tin", icon: "💬" },
    "Friend Management": { label: "Quản lý bạn bè", icon: "🤝" },
    "Group Management": { label: "Quản lý nhóm", icon: "👥" },
    "User & Account": { label: "Tài khoản người dùng", icon: "👤" },
    "Conversation Management": { label: "Cuộc trò chuyện", icon: "💭" },
    "Reminders & Auto-Reply": { label: "Nhắc nhở & Auto-Reply", icon: "🔔" },
    "Notes & Quick Messages": { label: "Ghi chú & Tin nhanh", icon: "📝" },
    "Catalogs & Products": { label: "Catalog & Sản phẩm", icon: "🛍️" },
    "Polls & Boards": { label: "Bình chọn & Bảng", icon: "📊" },
    "Media & Stickers": { label: "Media & Sticker", icon: "🎨" },
    "Settings & Utility": { label: "Cài đặt & Tiện ích", icon: "⚙️" },
    Other: { label: "Khác", icon: "📦" },
};

/**
 * Methods pinned to the top of the sidebar — sorted by frequency of real use.
 * These appear under a "⭐ Hay dùng" pseudo-category before the regular ones.
 */
const POPULAR_METHODS = [
    "fetchAccountInfo",
    "getOwnId",
    "getAllGroups",
    "getGroupInfo",
    "getGroupMembersInfo",
    "getAllFriends",
    "getUserInfo",
    "findUser",
    "sendMessage",
    "addUserToGroup",
    "removeUserFromGroup",
    "createGroup",
];

let allMethods = [];
let groupedMethods = [];
let selectedMethod = null;
let selectedAccountId = "";

// ---- Logout ----
$("#logoutBtn").addEventListener("click", async (ev) => {
    ev.preventDefault();
    try { await fetch("/admin/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    location.href = "/login.html";
});

// ---- Account picker ----
async function loadAccounts() {
    try {
        const data = await callApi("/accounts");
        const sel = $("#accountSelect");
        sel.innerHTML = '<option value="">— Chưa chọn —</option>';
        for (const a of data.accounts) {
            const opt = document.createElement("option");
            opt.value = a.id;
            opt.textContent = `${a.displayName ?? a.uid}${a.phone ? ` (${a.phone})` : ""}`;
            sel.appendChild(opt);
        }
        // Try to restore previous selection
        let saved = "";
        try { saved = localStorage.getItem(ACC_STORAGE) || ""; } catch {}
        if (saved && data.accounts.some((a) => a.id === saved)) {
            selectedAccountId = saved;
        } else if (data.accounts[0]) {
            selectedAccountId = data.accounts[0].id;
        }
        sel.value = selectedAccountId;
        if (selectedMethod) renderMethodPanel(selectedMethod);
    } catch (err) {
        toast(err.message, "error");
    }
}

$("#accountSelect").addEventListener("change", (e) => {
    selectedAccountId = e.target.value;
    try { localStorage.setItem(ACC_STORAGE, selectedAccountId); } catch {}
    if (selectedMethod) renderMethodPanel(selectedMethod);
});

// ---- Catalog ----
async function loadMethods() {
    try {
        const data = await callApi("/methods");
        groupedMethods = data.groups;
        allMethods = data.groups.flatMap((g) => g.methods);
        $("#methodCount").textContent = `${allMethods.length}`;
        renderCategoryList("");
    } catch (err) {
        toast(err.message, "error");
    }
}

function renderCategoryList(filter) {
    const f = filter.trim().toLowerCase();
    const list = $("#categoryList");
    list.innerHTML = "";
    let visible = 0;

    // Build the "popular" pseudo-group from POPULAR_METHODS in declared order.
    const popularGroup = {
        category: "__popular",
        methods: POPULAR_METHODS.map((name) => allMethods.find((m) => m.name === name)).filter(Boolean),
    };
    const groupsToRender = popularGroup.methods.length > 0
        ? [popularGroup, ...groupedMethods]
        : groupedMethods;

    for (const grp of groupsToRender) {
        const matched = grp.methods.filter(
            (m) =>
                !f ||
                m.name.toLowerCase().includes(f) ||
                (m.description ?? "").toLowerCase().includes(f),
        );
        if (matched.length === 0) continue;

        const isPopular = grp.category === "__popular";
        const meta = isPopular
            ? { label: "Hay dùng", icon: "⭐" }
            : CATEGORY_VI[grp.category] ?? { label: grp.category, icon: "📦" };
        const header = document.createElement("div");
        header.className = isPopular
            ? "sticky top-0 bg-amber-50 z-10 flex items-center gap-1.5 px-2 pt-3 pb-1 text-xs font-bold text-amber-700 -mx-2 mb-1"
            : "sticky top-0 bg-white z-10 flex items-center gap-1.5 px-1 pt-3 pb-1 text-xs font-bold text-slate-700";
        const countCls = isPopular
            ? "text-[10px] font-medium bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full"
            : "text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full";
        header.innerHTML = `
            <span>${meta.icon}</span>
            <span class="flex-1">${escapeHtml(meta.label)}</span>
            <span class="${countCls}">${matched.length}</span>
        `;
        list.appendChild(header);

        for (const m of matched) {
            const a = document.createElement("a");
            a.dataset.method = m.name;
            const isActive = selectedMethod?.name === m.name;
            a.className = isActive
                ? "block px-2.5 py-1.5 rounded cursor-pointer no-underline border-l-2 border-primary-600 bg-primary-50 mb-px"
                : "block px-2.5 py-1.5 rounded cursor-pointer no-underline border-l-2 border-transparent hover:bg-slate-50 mb-px";
            a.innerHTML = `
                <span class="block font-mono text-[13px] font-medium ${isActive ? "text-primary-700" : "text-slate-900"}">${escapeHtml(m.name)}</span>
                <span class="block text-[11px] text-slate-500 mt-0.5 leading-tight">${escapeHtml(shortDesc(m.description))}</span>
            `;
            a.addEventListener("click", (e) => {
                e.preventDefault();
                selectMethod(m.name);
            });
            list.appendChild(a);
            visible++;
        }
    }
    $("#methodCount").textContent = filter ? `${visible}/${allMethods.length}` : `${allMethods.length}`;
}

function shortDesc(s) {
    if (!s) return "";
    const trimmed = s.trim();
    return trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed;
}

$("#search").addEventListener("input", (e) => renderCategoryList(e.target.value));

// ---- Method selection ----
async function selectMethod(name) {
    try {
        const doc = await callApi(`/methods/${name}`);
        selectedMethod = doc;
        // Re-render the sidebar so highlighting updates
        renderCategoryList($("#search").value || "");
        renderMethodPanel(doc);
    } catch (err) {
        toast(err.message, "error");
    }
}

function effectiveAccountId() {
    return selectedAccountId || "<accountId>";
}

/**
 * Build the sample request body from method examples + paramNames.
 * Multi-arg → { paramName: arg }, single object arg → flatten.
 */
function argsToBody(args, paramNames) {
    if (paramNames.length === 0) return {};
    if (
        paramNames.length === 1 &&
        args[0] &&
        typeof args[0] === "object" &&
        !Array.isArray(args[0])
    ) {
        return args[0];
    }
    const obj = {};
    paramNames.forEach((name, i) => {
        if (args[i] !== undefined) obj[name] = args[i];
    });
    return obj;
}

// ---- Render method panel ----
function renderMethodPanel(doc) {
    $("#welcome").classList.add("hidden");
    $("#methodPanel").classList.remove("hidden");

    const catMeta = CATEGORY_VI[doc.category] ?? { label: doc.category, icon: "" };
    $("#methodCategory").textContent = `${catMeta.icon} ${catMeta.label}`;
    $("#methodName").textContent = doc.name;
    $("#methodDesc").textContent = doc.description;
    if (doc.notes) {
        $("#methodNotes").textContent = "💡 " + doc.notes;
        $("#methodNotes").classList.remove("hidden");
    } else {
        $("#methodNotes").classList.add("hidden");
    }

    const accId = effectiveAccountId();
    const fullPath = apiUrl(`/api/${accId}/${doc.name}`);
    const fullUrl = location.origin + fullPath;

    // 1. URL
    $("#docUrl").innerHTML =
        `<span class="bg-primary-600 text-white px-2 py-0.5 rounded text-[11px] font-bold tracking-wider mr-2">POST</span>${escapeHtml(fullUrl)}`;

    // 2. Body — first example
    const examples = doc.examples?.length ? doc.examples : [{ summary: "Default", args: [] }];
    const firstExample = examples[0];
    const reqBody = argsToBody(firstExample.args ?? [], doc.paramNames ?? []);
    $("#docRequest").textContent = JSON.stringify(reqBody, null, 2);

    // 4. Fields table
    renderFieldsTable(doc.fields ?? []);

    // 5. Response — actual envelope with sample data
    const sampleResp = {
        ok: true,
        data: doc.sampleResponse ?? { /* shape: xem return type */ },
        meta: { ts: Date.now(), ms: 142 },
    };
    $("#docResponse").textContent = JSON.stringify(sampleResp, null, 2);

    // 6. cURL
    const curl =
        `curl -X POST '${fullUrl}' \\\n` +
        `  -H 'Content-Type: application/json' \\\n` +
        `  -d '${JSON.stringify(reqBody)}'`;
    $("#docCurl").textContent = curl;

    // 7. More examples
    const moreBox = $("#docMoreExamples");
    moreBox.innerHTML = "";
    if (examples.length > 1) {
        examples.slice(1).forEach((ex) => {
            const wrap = document.createElement("div");
            wrap.className = "bg-slate-50 border border-slate-200 rounded p-3";
            const exBody = argsToBody(ex.args ?? [], doc.paramNames ?? []);
            wrap.innerHTML = `
                <div class="text-sm font-semibold mb-2">${escapeHtml(ex.summary)}</div>
                <pre class="bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs overflow-x-auto">${escapeHtml(JSON.stringify(exBody, null, 2))}</pre>
            `;
            moreBox.appendChild(wrap);
        });
        $("#examplesSection").classList.remove("hidden");
    } else {
        $("#examplesSection").classList.add("hidden");
    }
}

function renderFieldsTable(fields) {
    const tbody = $("#fieldsTable tbody");
    tbody.innerHTML = "";
    if (fields.length === 0) {
        $("#fieldsSection").classList.add("hidden");
        return;
    }
    $("#fieldsSection").classList.remove("hidden");
    fields.forEach((f) => {
        const tr = document.createElement("tr");
        const isNested = f.name.includes(".");
        const nameCls = isNested
            ? "ml-3 inline-block font-mono text-xs px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded"
            : "inline-block font-mono text-xs px-2 py-0.5 bg-primary-50 text-primary-700 border border-primary-200 rounded font-semibold";
        const reqCell = f.required
            ? '<span class="text-green-700 font-bold">✓</span>'
            : '<span class="text-slate-400">—</span>';
        tr.innerHTML = `
            <td class="px-3 py-2 align-top"><span class="${nameCls}">${escapeHtml(f.name)}</span></td>
            <td class="px-3 py-2 align-top font-mono text-xs text-purple-700">${escapeHtml(f.type)}</td>
            <td class="px-3 py-2 align-top">${reqCell}</td>
            <td class="px-3 py-2 align-top text-slate-700 leading-relaxed">${escapeHtml(f.description)}</td>
        `;
        tbody.appendChild(tr);
    });
}

$("#copyCurl").addEventListener("click", async () => {
    const text = $("#docCurl").textContent;
    try {
        await navigator.clipboard.writeText(text);
        toast("Đã copy cURL", "success");
    } catch {
        toast("Không copy được", "error");
    }
});

// ---- Init ----
loadKey();
(async () => {
    await Promise.all([loadAccounts(), loadMethods()]);
    if (allMethods.find((m) => m.name === "sendMessage")) selectMethod("sendMessage");
})();
