// Read-only JSON API for Pro and Accountant plans. Bearer API keys (stored hashed), per-key rate limit,
// consistent error JSON: { "error": { "code": "...", "message": "..." } }. Documented in site/api.html.
import fs from 'node:fs';
import path from 'node:path';
import { Accounts } from './accounts.js';
import { PLAN_INFO } from './plans.js';
import { readHistory, pragueMonth, prevMonth } from './history.js';
import { readStatus } from './canary.js';
import { isValidIco } from './ico.js';
import { clientIp, sweepHits } from './freecheck.js';

export const API_VERSION = 'v1';
const MAX_LIMIT = 200;

export class SlidingLimiter {
    constructor({ limit, windowMs = 60e3, now = () => Date.now() }) {
        Object.assign(this, { limit, windowMs, now }); this.hits = new Map();
        setInterval(() => sweepHits(this.hits, this.now() - this.windowMs), Math.min(windowMs, 60e3)).unref(); // forget IPs after the window (privacy policy)
    }
    take(key) {
        const t = this.now(); sweepHits(this.hits, t - this.windowMs);
        const h = this.hits.get(key) ?? [];
        if (h.length >= this.limit) return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((h[0] + this.windowMs - t) / 1000)) };
        h.push(t); this.hits.set(key, h);
        return { ok: true, remaining: this.limit - h.length };
    }
}

const err = (status, code, message, headers = {}) => ({ status, body: { error: { code, message } }, headers });

function overall(rec) {
    if (!rec) return 'pending';
    const st = Object.values(rec.checks ?? {}).map((c) => c.status);
    if (st.includes('alert') || st.includes('invalid')) return 'alert';
    if (st.includes('failed')) return 'failed';
    return 'ok';
}
function supplierJson(l, ico, rec) {
    return {
        ico, client: l.clientId ? { id: l.clientId, name: l.name } : null, website: l.websites?.[ico] ?? null,
        name: rec?.name ?? null, last_checked: rec?.at ?? null, status: overall(rec),
        checks: rec?.checks ?? null, alerts: rec?.alerts ?? [], changes: rec?.changes ?? [],
    };
}
function paging(q) {
    const lim = q.get('limit'); const off = q.get('offset');
    const limit = lim == null ? 50 : Number(lim); const offset = off == null ? 0 : Number(off);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: err(400, 'invalid_parameter', `limit must be an integer from 1 to ${MAX_LIMIT}`) };
    if (!Number.isInteger(offset) || offset < 0) return { error: err(400, 'invalid_parameter', 'offset must be a non-negative integer') };
    return { limit, offset };
}
const page = (all, { limit, offset }) => ({ data: all.slice(offset, offset + limit), pagination: { limit, offset, total: all.length, next_offset: offset + limit < all.length ? offset + limit : null } });

export function createApi({ dataDir, env = process.env, now = () => Date.now(), log = () => {} } = {}) {
    const perKey = new SlidingLimiter({ limit: Number(env.API_RATE_PER_MIN || 60), now });
    const badAuth = new SlidingLimiter({ limit: Number(env.API_BAD_AUTH_PER_MIN || 20), now });
    const accFile = path.join(dataDir, 'accounts.json');
    const latestFor = (a, l) => { const f = path.join(dataDir, 'state', `${l.clientId ? `${a.id}--${l.clientId}` : a.id}.json`); try { return JSON.parse(fs.readFileSync(f, 'utf8')).latest ?? {}; } catch { return {}; } };

    function authenticate(req) {
        const ip = clientIp(req);
        const h = String(req.headers.authorization ?? '');
        const fail = (e) => { const r = badAuth.take(ip); return r.ok ? { error: e } : { error: err(429, 'rate_limited', 'Too many failed authentication attempts. Try again later.', { 'retry-after': String(r.retryAfter) }) }; };
        if (!h) return fail(err(401, 'missing_api_key', 'Send your API key as "Authorization: Bearer <key>".', { 'www-authenticate': 'Bearer realm="supplierwatch"' }));
        const m = h.match(/^Bearer\s+(\S+)$/i);
        if (!m) return fail(err(401, 'invalid_api_key', 'Authorization header must be "Bearer <key>".', { 'www-authenticate': 'Bearer error="invalid_token"' }));
        const acc = new Accounts(accFile, { now });
        const found = acc.byApiKey(m[1]);
        if (!found) return fail(err(401, 'invalid_api_key', 'API key not recognised.', { 'www-authenticate': 'Bearer error="invalid_token"' }));
        if (found.revoked) return fail(err(401, 'revoked_api_key', 'This API key has been revoked. Create a new one on your manage page.', { 'www-authenticate': 'Bearer error="invalid_token"' }));
        const a = found.account;
        if (!PLAN_INFO[a.plan]?.api) return { error: err(403, 'plan_required', 'API access needs the Pro or Accountant plan. Upgrade on your manage page.') };
        if (!a.confirmed) return { error: err(403, 'account_not_confirmed', 'Confirm your email address first.') };
        if (a.deleteAt) return { error: err(403, 'account_pending_deletion', `This account is scheduled for deletion on ${a.deleteAt.slice(0, 10)}. Keep it on your manage page to use the API again.`) };
        if (!found.key.lastUsedAt || now() - Date.parse(found.key.lastUsedAt) > 10 * 60e3) { found.key.lastUsedAt = new Date(now()).toISOString(); try { acc.save(); } catch (e) { log(`api: could not save lastUsedAt: ${e.message}`); } }
        return { acc, account: a, key: found.key };
    }

    /** Returns { status, body, headers } for /api/... paths, or null for other paths. */
    return async function handleApi(req, url) {
        const P = url.pathname.replace(/\/+$/, '');
        if (!P.startsWith('/api')) return null;
        if (req.method !== 'GET' && req.method !== 'HEAD') return err(405, 'method_not_allowed', 'The API is read-only; use GET.', { allow: 'GET, HEAD' });
        const m = P.match(/^\/api\/v1(?:\/(suppliers|alerts|clients|sources|account))?(?:\/([^/]+))?$/);
        if (!m || (m[2] && m[1] !== 'suppliers')) return err(404, 'not_found', 'Unknown endpoint. See https://supplierwatch.cz/api.html');
        const auth = authenticate(req);
        if (auth.error) return auth.error;
        const rl = perKey.take(auth.key.id);
        const rlh = { 'x-ratelimit-limit': String(perKey.limit), 'x-ratelimit-remaining': String(rl.remaining) };
        if (!rl.ok) return err(429, 'rate_limited', `Rate limit of ${perKey.limit} requests per minute exceeded.`, { ...rlh, 'retry-after': String(rl.retryAfter) });
        const ok = (body) => ({ status: 200, body, headers: rlh });
        const { acc, account: a } = auth; const q = url.searchParams;
        const lists = acc.lists(a);
        const res = m[1] ?? '';

        if (res === '' || res === 'account') {
            return ok({ data: { email: a.email, plan: a.plan, supplier_limit: acc.limit(a), suppliers: lists.reduce((n, l) => n + l.icos.length, 0), clients: acc.hasClients(a) ? (a.clients ?? []).length : null, api_version: API_VERSION } });
        }
        if (res === 'sources') { const st = readStatus(dataDir); return ok({ data: st ? { checked_at: st.checkedAt, ok: st.ok, sources: st.sources } : null }); }
        if (res === 'clients') {
            if (!acc.hasClients(a)) return err(403, 'plan_required', 'Client lists need the Accountant plan.', rlh);
            const p = paging(q); if (p.error) return { ...p.error, headers: { ...p.error.headers, ...rlh } };
            const all = (a.clients ?? []).map((c) => { const l = lists.find((x) => x.clientId === c.id); return { id: c.id, name: c.name, suppliers: l?.icos.length ?? 0, recipients: (c.recipients ?? []).length }; });
            return ok(page(all, p));
        }
        let scoped = lists;
        if (q.has('client')) {
            const c = q.get('client');
            scoped = c === 'main' ? lists.filter((l) => !l.clientId) : lists.filter((l) => l.clientId === c);
            if (!scoped.length) return err(404, 'not_found', 'No such client on this account.', rlh);
        }
        if (res === 'suppliers' && m[2]) {
            const ico = decodeURIComponent(m[2]);
            if (!/^\d{8}$/.test(ico) || !isValidIco(ico)) return err(400, 'invalid_ico', 'IČO must be 8 digits with a valid check digit.', rlh);
            const hits = scoped.filter((l) => l.icos.includes(ico));
            if (!hits.length) return err(404, 'not_found', 'This IČO is not on your supplier list.', rlh);
            const entries = hits.map((l) => supplierJson(l, ico, latestFor(a, l)[ico]));
            return ok({ data: entries[0], ...(entries.length > 1 ? { also_in: entries.slice(1) } : {}) });
        }
        if (res === 'suppliers') {
            const p = paging(q); if (p.error) return { ...p.error, headers: { ...p.error.headers, ...rlh } };
            const status = q.get('status');
            if (status && !['ok', 'alert', 'failed', 'pending'].includes(status)) return err(400, 'invalid_parameter', 'status must be ok, alert, failed or pending', rlh);
            let all = scoped.flatMap((l) => { const lt = latestFor(a, l); return l.icos.map((ico) => supplierJson(l, ico, lt[ico])); });
            if (status) all = all.filter((s) => s.status === status);
            return ok(page(all, p));
        }
        if (res === 'alerts') {
            const p = paging(q); if (p.error) return { ...p.error, headers: { ...p.error.headers, ...rlh } };
            const sinceRaw = q.get('since');
            const since = sinceRaw ? Date.parse(sinceRaw) : now() - 30 * 864e5;
            if (sinceRaw && (Number.isNaN(since) || !/^\d{4}-\d{2}-\d{2}/.test(sinceRaw))) return err(400, 'invalid_parameter', 'since must be an ISO 8601 date or time, e.g. 2026-10-01 or 2026-10-01T06:00:00Z', rlh);
            if (since < now() - 731 * 864e5) return err(400, 'invalid_parameter', 'since can be at most 24 months ago (history retention).', rlh);
            const keys = new Set(scoped.map((l) => l.key));
            const months = []; let mo = pragueMonth(new Date(now())); const first = pragueMonth(new Date(since));
            while (mo >= first && months.length < 26) { months.push(mo); mo = prevMonth(mo); }
            const all = months.flatMap((x) => readHistory(dataDir, a.id, x))
                .filter((r) => keys.has(r.list) && Date.parse(r.at) >= since && (r.alerts?.length || r.changes?.length || Object.values(r.checks ?? {}).some((c) => c.status === 'failed')))
                .sort((x, y) => y.at.localeCompare(x.at))
                .map((r) => ({ at: r.at, ico: r.ico, name: r.name, client: r.list === 'main' ? null : { id: r.list, name: r.client }, alerts: r.alerts ?? [], changes: r.changes ?? [], failed_checks: Object.entries(r.checks ?? {}).filter(([, c]) => c.status === 'failed').map(([k]) => k) }));
            return ok(page(all, p));
        }
        return err(404, 'not_found', 'Unknown endpoint.', rlh);
    };
}
