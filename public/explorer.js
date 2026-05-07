const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, kind = "info") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

/**
 * fetch() wrapper that understands the unified envelope:
 *   success → { ok: true, data, meta }
 *   failure → { ok: false, error: { code, message, issues? }, meta }
 *
 * Returns the FULL envelope (not just data) so callers can show meta.ms.
 * Throws on network errors and on `ok: false` payloads, with the envelope
 * attached to the error so callers can still show the structured response.
 */
async function callApi(path, opts = {}) {
    const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...opts,
    });
    if (res.status === 401) {
        location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
        throw new Error("Phiên hết hạn");
    }
    if (res.status === 204) {
        return { ok: true, data: null, meta: { ts: Date.now() } };
    }
    let payload;
    try {
        payload = await res.json();
    } catch {
        const err = new Error(`HTTP ${res.status}`);
        err.envelope = null;
        throw err;
    }
    if (payload && payload.ok === true) return payload;
    if (payload && payload.ok === false) {
        const err = new Error(payload.error?.message ?? `HTTP ${res.status}`);
        err.envelope = payload;
        err.code = payload.error?.code;
        throw err;
    }
    // Unexpected shape — wrap it
    const err = new Error(`Unexpected response shape (HTTP ${res.status})`);
    err.envelope = { ok: false, error: { code: "INTERNAL_ERROR", message: err.message }, meta: { ts: Date.now() } };
    throw err;
}

let allMethods = [];
let groupedMethods = [];
let selectedMethod = null;
let accounts = [];
let selectedAccountId = "";

// ---------- Accounts ------------------------------------------------

async function loadAccounts() {
    try {
        const env = await callApi("/accounts");
        accounts = env.data.accounts;
        const sel = $("#accountSelect");
        sel.innerHTML = "";
        if (accounts.length === 0) {
            sel.innerHTML =
                '<option value="">— Chưa có tài khoản, vào trang Tài khoản để thêm —</option>';
        } else {
            sel.innerHTML = accounts
                .map(
                    (a) =>
                        `<option value="${a.id}">${escapeHtml(
                            a.displayName ?? a.uid,
                        )} ${a.phone ? `(${a.phone})` : ""}</option>`,
                )
                .join("");
            selectedAccountId = accounts[0].id;
        }
    } catch (err) {
        toast(err.message, "error");
    }
}

$("#accountSelect").addEventListener("change", (e) => {
    selectedAccountId = e.target.value;
});

// ---------- Methods catalog ----------------------------------------

async function loadMethods() {
    try {
        const env = await callApi("/methods");
        groupedMethods = env.data.groups;
        allMethods = env.data.groups.flatMap((g) => g.methods);
        $("#methodCount").textContent = `${allMethods.length}`;
        renderMethodList("");
    } catch (err) {
        toast(err.message, "error");
    }
}

function renderMethodList(filter) {
    const f = filter.trim().toLowerCase();
    const list = $("#methodList");
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
        const header = document.createElement("div");
        header.className = "category-header";
        header.textContent = grp.category;
        list.appendChild(header);
        for (const m of matched) {
            const a = document.createElement("a");
            a.className = "method-link";
            a.dataset.method = m.name;
            a.textContent = m.name;
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

$("#search").addEventListener("input", (e) => renderMethodList(e.target.value));

// ---------- Method panel ------------------------------------------

async function selectMethod(name) {
    try {
        const env = await callApi(`/methods/${name}`);
        selectedMethod = env.data;
        $$(".method-link").forEach((el) =>
            el.classList.toggle("active", el.dataset.method === name),
        );
        renderMethodPanel(env.data);
    } catch (err) {
        toast(err.message, "error");
    }
}

function renderMethodPanel(doc) {
    $("#welcome").classList.add("hidden");
    $("#methodPanel").classList.remove("hidden");
    $("#methodCategory").textContent = doc.category;
    $("#methodName").textContent = doc.name;
    $("#methodDesc").textContent = doc.description;
    if (doc.notes) {
        $("#methodNotes").textContent = doc.notes;
        $("#methodNotes").classList.remove("hidden");
    } else {
        $("#methodNotes").classList.add("hidden");
    }
    $("#methodSignature").textContent = `${doc.name}${doc.params}: ${doc.returnType}`;

    const tabs = $("#exampleTabs");
    tabs.innerHTML = "";
    const examples = doc.examples?.length ? doc.examples : [{ summary: "Default", args: [] }];
    examples.forEach((ex, i) => {
        const btn = document.createElement("button");
        btn.className = "example-tab";
        btn.textContent = ex.summary;
        btn.addEventListener("click", () => loadExample(ex));
        tabs.appendChild(btn);
        if (i === 0) loadExample(ex);
    });

    $("#responseView").className = "response";
    $("#responseView").textContent = "— chưa chạy —";
    $("#runStatus").textContent = "";
    $("#runStatus").className = "muted";
}

function loadExample(ex) {
    $("#argsEditor").value = JSON.stringify({ args: ex.args ?? [] }, null, 2);
}

// ---------- Run method --------------------------------------------

$("#executeBtn").addEventListener("click", async () => {
    if (!selectedMethod) return toast("Chọn method trước", "error");
    if (!selectedAccountId) return toast("Chọn tài khoản trước", "error");

    let body;
    try {
        body = JSON.parse($("#argsEditor").value || "{}");
        if (!body || !Array.isArray(body.args)) {
            throw new Error("Body phải có shape { args: [...] }");
        }
    } catch (err) {
        return toast(`JSON không hợp lệ: ${err.message}`, "error");
    }

    const btn = $("#executeBtn");
    btn.disabled = true;
    btn.textContent = "Đang chạy…";
    $("#runStatus").textContent = "Sending…";
    $("#runStatus").className = "muted";

    const t0 = performance.now();
    try {
        const env = await callApi(`/api/${selectedAccountId}/${selectedMethod.name}`, {
            method: "POST",
            body: JSON.stringify(body),
        });
        const ms = Math.round(performance.now() - t0);
        $("#responseView").className = "response success";
        $("#responseView").textContent = JSON.stringify(env, null, 2);
        $("#runStatus").textContent = `OK (${ms}ms)`;
        $("#runStatus").className = "success";
    } catch (err) {
        const ms = Math.round(performance.now() - t0);
        $("#responseView").className = "response error";
        $("#responseView").textContent = JSON.stringify(
            err.envelope ?? { ok: false, error: { message: err.message } },
            null,
            2,
        );
        $("#runStatus").textContent = `${err.code ?? "Error"} (${ms}ms)`;
        $("#runStatus").className = "error";
    } finally {
        btn.disabled = false;
        btn.textContent = "Execute";
    }
});

$("#copyCurlBtn").addEventListener("click", async () => {
    if (!selectedMethod || !selectedAccountId) {
        return toast("Chọn account + method trước", "error");
    }
    const body = $("#argsEditor").value || "{}";
    let parsed;
    try { parsed = JSON.parse(body); } catch { return toast("Body chưa hợp lệ", "error"); }
    const curl =
        `curl -X POST '${location.origin}/api/${selectedAccountId}/${selectedMethod.name}' \\\n` +
        `  -H 'Content-Type: application/json' \\\n` +
        `  -d '${JSON.stringify(parsed)}'`;
    try {
        await navigator.clipboard.writeText(curl);
        toast("Đã copy cURL", "success");
    } catch {
        toast("Không copy được — xem console", "error");
        console.log(curl);
    }
});

// ---------- Quick Actions (JSON-driven) ---------------------------

$$(".qa-card").forEach((card) => {
    const action = card.dataset.action;
    const runBtn = card.querySelector(".qa-run");
    const bodyEl = card.querySelector(".qa-body");
    const outEl = card.querySelector(".qa-output");

    runBtn.addEventListener("click", async () => {
        if (!selectedAccountId) return toast("Chọn tài khoản trước", "error");
        let body;
        try {
            body = JSON.parse(bodyEl.value || "{}");
        } catch (err) {
            outEl.className = "qa-output error";
            outEl.textContent = `JSON không hợp lệ: ${err.message}`;
            return;
        }
        runBtn.disabled = true;
        runBtn.textContent = "Đang chạy…";
        try {
            const env = await callApi(`/quick/${selectedAccountId}/${action}`, {
                method: "POST",
                body: JSON.stringify(body),
            });
            outEl.className = "qa-output success";
            outEl.textContent = JSON.stringify(env, null, 2);
        } catch (err) {
            outEl.className = "qa-output error";
            outEl.textContent = JSON.stringify(
                err.envelope ?? { ok: false, error: { message: err.message } },
                null,
                2,
            );
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = "Run";
        }
    });
});

// ---------- Logout -------------------------------------------------

document.getElementById("logoutBtn")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try {
        await fetch("/admin/logout", { method: "POST", credentials: "same-origin" });
    } catch {}
    location.href = "/login.html";
});

// ---------- Init --------------------------------------------------

function escapeHtml(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

(async () => {
    await Promise.all([loadAccounts(), loadMethods()]);
    if (allMethods.find((m) => m.name === "fetchAccountInfo")) {
        selectMethod("fetchAccountInfo");
    }
})();
