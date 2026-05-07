/**
 * auth-guard.js — checks /admin/me and:
 *   - if authEnabled=false → no-op (open dev mode)
 *   - if authEnabled=true and not logged in → redirect to /login.html
 *
 * Include as <script src="/auth-guard.js"></script> at the top of <head> on
 * any protected page. Sets window.__authReady (a Promise) so other scripts
 * can `await window.__authReady` before making /accounts requests.
 */
window.__authReady = (async () => {
    try {
        const r = await fetch("/admin/me", { credentials: "same-origin" });
        if (r.status === 401) {
            const next = encodeURIComponent(location.pathname + location.search);
            location.replace(`/login.html?next=${next}`);
            return null;
        }
        const d = await r.json();
        if (!d.ok) return null;
        return d.data;
    } catch (err) {
        console.error("auth-guard failed", err);
        return null;
    }
})();
