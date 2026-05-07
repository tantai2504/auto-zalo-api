const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, kind = "info") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
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

// ---- Vietnamese labels for category groups ----
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

// ---- Account picker (dùng để in trong ví dụ) ----
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
        if (data.accounts[0]) {
            selectedAccountId = data.accounts[0].id;
            sel.value = selectedAccountId;
        }
        if (selectedMethod) renderMethodPanel(selectedMethod);
    } catch (err) {
        toast(err.message, "error");
    }
}

$("#accountSelect").addEventListener("change", (e) => {
    selectedAccountId = e.target.value;
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

    for (const grp of groupedMethods) {
        const matched = grp.methods.filter(
            (m) =>
                !f ||
                m.name.toLowerCase().includes(f) ||
                (m.description ?? "").toLowerCase().includes(f),
        );
        if (matched.length === 0) continue;

        const meta = CATEGORY_VI[grp.category] ?? { label: grp.category, icon: "📦" };

        const header = document.createElement("div");
        header.className = "category-header";
        header.innerHTML = `<span class="cat-icon">${meta.icon}</span><span class="cat-label">${escapeHtml(meta.label)}</span><span class="cat-count">${matched.length}</span>`;
        list.appendChild(header);

        for (const m of matched) {
            const a = document.createElement("a");
            a.className = "method-link";
            a.dataset.method = m.name;
            a.innerHTML = `
                <span class="method-name">${escapeHtml(m.name)}</span>
                <span class="method-blurb">${escapeHtml(shortDesc(m.description))}</span>
            `;
            if (selectedMethod?.name === m.name) a.classList.add("active");
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

// ---- Render method panel (URL / Headers / Body / Response) ----
async function selectMethod(name) {
    try {
        const doc = await callApi(`/methods/${name}`);
        selectedMethod = doc;
        $$(".method-link").forEach((el) =>
            el.classList.toggle("active", el.dataset.method === name),
        );
        renderMethodPanel(doc);
    } catch (err) {
        toast(err.message, "error");
    }
}

function effectiveAccountId() {
    return selectedAccountId || "<accountId>";
}

/**
 * Parse a TS-style params string like:
 *   "(message: MessageContent | string, threadId: string, type?: ThreadType)"
 * into a list of { name, type, optional } so we can show descriptions per arg.
 */
function parseParams(paramsStr) {
    const inner = paramsStr.replace(/^\(|\)$/g, "").trim();
    if (!inner) return [];
    // Split by top-level commas (depth-aware to handle generics)
    const parts = [];
    let depth = 0;
    let buf = "";
    for (const ch of inner) {
        if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
        else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
            parts.push(buf.trim());
            buf = "";
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts.map((p) => {
        const m = /^([\w$]+)(\?)?\s*:\s*(.+)$/.exec(p);
        if (!m) return { name: p, type: "", optional: false };
        return { name: m[1], type: m[3].trim(), optional: !!m[2] };
    });
}

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
        `<span class="http-verb">POST</span>${escapeHtml(fullUrl)}`;

    // 2. Headers
    $("#docHeaders").textContent =
        `Content-Type: application/json
X-API-Key: zk_xxxxxxxxx...

# Hoặc dùng Bearer thay vì X-API-Key:
# Authorization: Bearer zk_xxxxxxxxx...`;

    // 3. Request body — first example.
    // Body chính là mảng args trực tiếp. Method không tham số → mảng rỗng [].
    const examples = doc.examples?.length ? doc.examples : [{ summary: "Default", args: [] }];
    const firstExample = examples[0];
    const reqBody = firstExample.args ?? [];
    $("#docRequest").textContent = JSON.stringify(reqBody, null, 2);

    // Field descriptions parsed from TS signature
    const fields = parseParams(doc.params);
    if (fields.length > 0) {
        $("#docFields").classList.remove("hidden");
        const ul = $("#docFieldList");
        ul.innerHTML = "";
        fields.forEach((f, i) => {
            const li = document.createElement("li");
            li.innerHTML = `
                <code>args[${i}]</code>
                <span class="field-name">${escapeHtml(f.name)}</span>
                ${f.optional ? '<span class="field-opt">(tuỳ chọn)</span>' : ""}
                <span class="field-type">${escapeHtml(f.type)}</span>
            `;
            ul.appendChild(li);
        });
    } else {
        $("#docFields").classList.add("hidden");
    }

    // 4. Response — show envelope shape with returnType
    const sampleResp = {
        ok: true,
        data: `<${doc.returnType.replace(/\s+/g, " ").replace(/^Promise<|>$/g, "")}>`,
        meta: { ts: Date.now(), ms: 142 },
    };
    $("#docResponse").textContent = JSON.stringify(sampleResp, null, 2);

    // 5. More examples (skip first since shown above)
    const moreBox = $("#docMoreExamples");
    moreBox.innerHTML = "";
    if (examples.length > 1) {
        examples.slice(1).forEach((ex) => {
            const wrap = document.createElement("div");
            wrap.className = "example-card";
            wrap.innerHTML = `
                <div class="example-summary">${escapeHtml(ex.summary)}</div>
                <pre class="code-block code-json">${escapeHtml(JSON.stringify(ex.args ?? [], null, 2))}</pre>
            `;
            moreBox.appendChild(wrap);
        });
    } else {
        moreBox.innerHTML = '<p class="muted">Chỉ có 1 ví dụ trên.</p>';
    }

    // 6. cURL
    const curl =
        `curl -X POST '${fullUrl}' \\\n` +
        `  -H 'Content-Type: application/json' \\\n` +
        `  -H 'X-API-Key: zk_xxxxxxxxx...' \\\n` +
        `  -d '${JSON.stringify(reqBody)}'`;
    $("#docCurl").textContent = curl;
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
(async () => {
    await Promise.all([loadAccounts(), loadMethods()]);
    if (allMethods.find((m) => m.name === "sendMessage")) selectMethod("sendMessage");
})();
