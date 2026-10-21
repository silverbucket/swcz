// Customer accounts: double opt-in, magic links, plan + supplier limit. Stored in SQLite (one JSON row per account).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isValidIco, normaliseIco } from './ico.js';
import { normalizeDomain } from './sources/coi.js';
import { parseText as parseCsvText, looksLikeCsv } from './csv.js';

import { PLANS, PLAN_BY_AMOUNT, PLAN_INFO, MAX_CLIENTS } from './plans.js';
export { PLANS };
export const TOKEN_TTL_MS = { confirm: 48 * 3600e3, manage: 24 * 3600e3 };
const token = () => crypto.randomBytes(24).toString('base64url');
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const normEmail = (e) => String(e ?? '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(e) && e.length <= 254;

/** Normalise a supplier website to a bare (punycode) domain, or null if it is not a plausible domain. */
export function normaliseWebsite(input) {
    const d = normalizeDomain(input);
    if (!d || d.length > 253 || /[\s@]/.test(d)) return null;
    let host;
    try { host = new URL(`http://${d}`).hostname; } catch { return null; }
    host = host.replace(/^www\./, '');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host)) return null;
    return host;
}

/**
 * Parse free text into unique valid IČO, each optionally followed by its website
 * ("27082440 firma.cz"). Returns { icos, websites: {ico: domain}, invalid }.
 */
export function parseIcos(text) {
    const icos = []; const invalid = []; const websites = {}; let last = null;
    for (const raw of String(text ?? '').split(/[\s,;]+/).filter(Boolean)) {
        if (/[a-z]/i.test(raw) && raw.includes('.')) { // looks like a website: attach to the preceding IČO
            const w = normaliseWebsite(raw);
            if (w && last) websites[last] = w; else invalid.push(raw);
            continue;
        }
        const t = raw.replace(/[^0-9]/g, '');
        if (t && t.length <= 8 && isValidIco(t)) { const n = normaliseIco(t); if (!icos.includes(n)) icos.push(n); last = n; } else { invalid.push(raw); last = null; }
    }
    return { icos, websites, invalid };
}
/**
 * Parse a submitted form: structured rows (repeated "ico"/"web" fields) plus the legacy/paste "icos" text.
 * `params` is a URLSearchParams. Returns { icos, websites, invalid } like parseIcos.
 */
export function parseSupplierForm(params) {
    const p = params instanceof URLSearchParams ? params : new URLSearchParams(params);
    const icos = []; const websites = {}; const invalid = [];
    const rowIcos = p.getAll('ico'); const rowWebs = p.getAll('web');
    rowIcos.forEach((rawIco, i) => {
        const ri = String(rawIco ?? '').trim(); const rw = String(rowWebs[i] ?? '').trim();
        if (!ri && !rw) return;
        const t = ri.replace(/\s/g, '');
        if (!/^\d{1,8}$/.test(t) || !isValidIco(t)) { invalid.push(ri || rw); return; }
        const n = normaliseIco(t); if (!icos.includes(n)) icos.push(n);
        if (rw) { const w = normaliseWebsite(rw); if (w) websites[n] = w; else invalid.push(rw); }
    });
    const pasted = p.get('icos');
    const legacy = looksLikeCsv(pasted) ? fromCsv(pasted) : parseIcos(pasted);
    for (const i of legacy.icos) if (!icos.includes(i)) icos.push(i);
    for (const [i, w] of Object.entries(legacy.websites)) if (!websites[i]) websites[i] = w;
    invalid.push(...legacy.invalid);
    return { icos, websites, invalid };
}
/** A pasted CSV export (with an IČO header) -> { icos, websites, invalid } using the shared import parser. */
function fromCsv(text) {
    const r = parseCsvText(text);
    return { icos: r.rows.map((x) => x.ico), websites: Object.fromEntries(r.rows.filter((x) => x.web).map((x) => [x.ico, x.web])), invalid: r.invalid.filter((x) => x.reason === 'invalid IČO').map((x) => x.value) };
}
export const pickWebsites = (icos, websites = {}) => Object.fromEntries(icos.filter((i) => websites[i]).map((i) => [i, websites[i]]));
/** Supplier list as editable text: "IČO website" per line. */
export const suppliersText = (a) => a.icos.map((i) => (a.websites?.[i] ? `${i} ${a.websites[i]}` : i)).join('\n');

const conns = new Map();
const tx = (db, fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
/** SQLite store next to the legacy JSON file (accounts.json -> accounts.db), shared by the web app and the daily run. */
function openDb(file) {
    const dbFile = file.replace(/\.json$/, '') + '.db';
    if (conns.has(dbFile)) return conns.get(dbFile);
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    fs.chmodSync(dbFile, 0o600);
    db.exec(`PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, exp INTEGER NOT NULL);`);
    if (fs.existsSync(file)) { // one-time import of the old JSON store; the file is kept as accounts.json.migrated
        tx(db, () => {
            if (db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) return;
            const old = JSON.parse(fs.readFileSync(file, 'utf8'));
            const put = db.prepare('INSERT INTO accounts (id, data) VALUES (?, ?)'); const tok = db.prepare('INSERT OR IGNORE INTO tokens VALUES (?, ?, ?, ?)');
            for (const a of Object.values(old.accounts ?? {})) put.run(a.id, JSON.stringify(a));
            for (const [h, v] of Object.entries(old.tokens ?? {})) tok.run(h, v.accountId, v.kind, v.exp);
        });
        try { fs.renameSync(file, `${file}.migrated`); } catch { /* another process renamed it first */ }
    }
    conns.set(dbFile, db);
    return db;
}

export class Accounts {
    constructor(file, { now = () => Date.now() } = {}) {
        this.file = file; this.now = now; this.sql = openDb(file);
        const rows = this.sql.prepare('SELECT id, data FROM accounts').all();
        this.db = { accounts: Object.fromEntries(rows.map((r) => [r.id, JSON.parse(r.data)])) };
        this.snap = new Map(rows.map((r) => [r.id, r.data]));
    }
    /**
     * Write accounts changed since load. Merge per top-level field against the current row, so a concurrent
     * writer (web app vs. daily run) keeps the fields it changed, e.g. an unsubscribe during a long run.
     */
    save() {
        const changed = this.all().filter((a) => JSON.stringify(a) !== this.snap.get(a.id));
        if (!changed.length) return;
        const get = this.sql.prepare('SELECT data FROM accounts WHERE id = ?');
        const put = this.sql.prepare('INSERT INTO accounts (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
        tx(this.sql, () => {
            for (const a of changed) {
                const before = JSON.parse(this.snap.get(a.id) ?? '{}'); const row = get.get(a.id); const cur = row ? JSON.parse(row.data) : {};
                for (const k of new Set([...Object.keys(before), ...Object.keys(a)])) {
                    if (JSON.stringify(a[k]) === JSON.stringify(before[k])) continue;
                    if (a[k] === undefined) delete cur[k]; else cur[k] = a[k];
                }
                put.run(a.id, JSON.stringify(cur));
            }
        });
        for (const a of changed) this.snap.set(a.id, JSON.stringify(a));
    }
    get(id) { return this.db.accounts[id] ?? null; }
    byEmail(email) { const e = normEmail(email); return Object.values(this.db.accounts).find((a) => a.email === e) ?? null; }
    byStripeCustomer(cus) { return Object.values(this.db.accounts).find((a) => a.stripeCustomer === cus) ?? null; }
    all() { return Object.values(this.db.accounts); }
    limit(a) { return PLANS[a?.plan] ?? PLANS.free; }

    /** Create or refresh a pending signup. Returns { account, confirmToken }. */
    signup(email, icos, { consentText, websites = {} }) {
        const e = normEmail(email);
        let a = this.byEmail(e);
        if (!a) {
            a = { id: `acc_${crypto.randomBytes(8).toString('hex')}`, email: e, createdAt: new Date(this.now()).toISOString(), confirmed: false, plan: 'free', icos: [], unsubscribed: false, unsubToken: token() };
            this.db.accounts[a.id] = a;
        }
        if (!a.confirmed) { a.icos = icos.slice(0, this.limit(a)); a.websites = pickWebsites(a.icos, websites); } // confirmed users edit via the manage link
        a.pendingConsent = { text: consentText, at: new Date(this.now()).toISOString() };
        return { account: a, confirmToken: this.issue(a.id, 'confirm') };
    }
    // Tokens are written straight to the database (no save() needed).
    issue(accountId, kind) { const t = token(); this.sql.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?)').run(hash(t), accountId, kind, this.now() + TOKEN_TTL_MS[kind]); this.prune(); return t; }
    prune() { this.sql.prepare('DELETE FROM tokens WHERE exp < ?').run(this.now()); }
    /** Look up a token; confirm tokens are single use, manage tokens stay valid until expiry. */
    use(t, kind) {
        const h = hash(t); const rec = this.sql.prepare('SELECT account_id, kind, exp FROM tokens WHERE hash = ?').get(h);
        if (!rec || rec.kind !== kind || rec.exp < this.now()) return null;
        if (kind === 'confirm' && !this.sql.prepare('DELETE FROM tokens WHERE hash = ?').run(h).changes) return null;
        return this.get(rec.account_id);
    }
    confirm(t) {
        const a = this.use(t, 'confirm'); if (!a) return null;
        a.confirmed = true; a.unsubscribed = false;
        a.consent = a.pendingConsent ?? a.consent; a.consent.confirmedAt = new Date(this.now()).toISOString();
        delete a.pendingConsent; return a;
    }
    setIcos(a, icos, websites = {}) { return this.setIcosMain(a, icos, websites); }
    unsubscribe(t) {
        if (!t) return null;
        const a = this.all().find((x) => x.unsubToken === t); if (a) { a.unsubscribed = true; return a; }
        for (const acc of this.all()) for (const c of acc.clients ?? []) for (const r of c.recipients ?? []) if (r.unsubToken === t) { r.unsubscribed = true; return acc; }
        return null;
    }

    // ---- Accountant plan: client lists. The plan limit is the total across the main list and all client lists.
    hasClients(a) { return Boolean(PLAN_INFO[a?.plan]?.clients); }
    total(a, exceptClient = null) { return (exceptClient === 'main' ? 0 : a.icos.length) + (a.clients ?? []).filter((c) => c.id !== exceptClient).reduce((n, c) => n + c.icos.length, 0); }
    client(a, id) { return (a.clients ?? []).find((c) => c.id === id) ?? null; }
    addClient(a, name) {
        const n = String(name ?? '').trim().slice(0, 120);
        if (!this.hasClients(a)) return { error: 'Client lists need the Accountant plan.' };
        if (!n) return { error: 'Enter a client name.' };
        a.clients ??= [];
        if (a.clients.length >= MAX_CLIENTS) return { error: `At most ${MAX_CLIENTS} clients.` };
        const c = { id: `cl_${crypto.randomBytes(6).toString('hex')}`, name: n, icos: [], websites: {}, recipients: [], createdAt: new Date(this.now()).toISOString() };
        a.clients.push(c); return { client: c };
    }
    renameClient(a, id, name) { const c = this.client(a, id); const n = String(name ?? '').trim().slice(0, 120); if (c && n) c.name = n; return c; }
    removeClient(a, id) { const before = (a.clients ?? []).length; a.clients = (a.clients ?? []).filter((c) => c.id !== id); return a.clients.length < before; }
    setClientIcos(a, id, icos, websites = {}) {
        const c = this.client(a, id); if (!c) return null;
        const room = Math.max(0, this.limit(a) - this.total(a, id));
        c.icos = icos.slice(0, room); c.websites = pickWebsites(c.icos, websites);
        return { kept: c.icos.length, dropped: Math.max(0, icos.length - room) };
    }
    /** Optional extra alert recipients for a client list (max 5); existing recipients keep their unsubscribe token/state. */
    setClientRecipients(a, id, text) {
        const c = this.client(a, id); if (!c) return null;
        const emails = [...new Set(String(text ?? '').split(/[\s,;]+/).map(normEmail).filter(Boolean))];
        const bad = emails.filter((e) => !validEmail(e)); const good = emails.filter(validEmail).slice(0, 5);
        c.recipients = good.map((e) => (c.recipients ?? []).find((r) => r.email === e) ?? { email: e, unsubToken: token(), unsubscribed: false });
        return { recipients: c.recipients, invalid: bad };
    }
    /**
     * Lists to check, in order, with the plan limit applied as one budget across them.
     * Client lists only run on a plan with clients (they are kept but paused after a downgrade).
     */
    lists(a) {
        let budget = this.limit(a); const out = [];
        const take = (icos) => { const k = icos.slice(0, Math.max(0, budget)); budget -= k.length; return k; };
        out.push({ key: 'main', clientId: null, name: null, icos: take(a.icos ?? []), websites: a.websites ?? {}, recipients: [] });
        if (this.hasClients(a)) for (const c of a.clients ?? []) out.push({ key: c.id, clientId: c.id, name: c.name, icos: take(c.icos), websites: c.websites ?? {}, recipients: (c.recipients ?? []).filter((r) => !r.unsubscribed) });
        return out;
    }
    setIcosMain(a, icos, websites = {}) { const room = Math.max(0, this.limit(a) - this.total(a, 'main')); a.icos = icos.slice(0, room); a.websites = pickWebsites(a.icos, websites); return { kept: a.icos.length, dropped: Math.max(0, icos.length - room) }; }

    // ---- API keys (Pro and Accountant). Only a SHA-256 hash is stored; the key is shown once.
    createApiKey(a, label = '') {
        if (!PLAN_INFO[a?.plan]?.api) return { error: 'API access needs the Pro or Accountant plan.' };
        a.apiKeys ??= [];
        if (a.apiKeys.filter((k) => !k.revokedAt).length >= 5) return { error: 'At most 5 active API keys. Revoke one first.' };
        const id = `key_${crypto.randomBytes(5).toString('hex')}`; const secret = `sw_${crypto.randomBytes(24).toString('base64url')}`;
        a.apiKeys.push({ id, label: String(label ?? '').trim().slice(0, 60), hash: hash(secret), prefix: secret.slice(0, 7), createdAt: new Date(this.now()).toISOString(), revokedAt: null, lastUsedAt: null });
        return { id, key: secret };
    }
    revokeApiKey(a, id) { const k = (a.apiKeys ?? []).find((x) => x.id === id && !x.revokedAt); if (k) k.revokedAt = new Date(this.now()).toISOString(); return Boolean(k); }
    /** Find the account for a presented key. Returns { account, key } or { revoked: true } or null. */
    byApiKey(secret) {
        if (!secret || !/^sw_[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
        const h = hash(secret);
        for (const a of this.all()) for (const k of a.apiKeys ?? []) {
            if (k.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(k.hash), Buffer.from(h))) return k.revokedAt ? { revoked: true, account: a, key: k } : { account: a, key: k };
        }
        return null;
    }

    /** Apply a Stripe event; returns a description or null. */
    applyStripe(ev) {
        const o = ev.data?.object ?? {};
        const meta = (m) => (m?.plan && PLANS[m.plan] !== undefined ? m.plan : null);
        if (ev.type === 'checkout.session.completed') {
            const a = (o.client_reference_id && this.get(o.client_reference_id)) || this.byEmail(o.customer_details?.email ?? o.customer_email);
            if (!a) return null;
            a.plan = meta(o.metadata) ?? 'starter'; a.stripeCustomer = o.customer ?? a.stripeCustomer; a.subscription = o.subscription ?? null;
            return `${a.id} -> ${a.plan}`;
        }
        if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
            const a = this.byStripeCustomer(o.customer); if (!a) return null;
            const active = ev.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(o.status);
            const price = o.items?.data?.[0]?.price;
            a.plan = active ? (meta(o.metadata) ?? meta(price?.metadata) ?? PLAN_BY_AMOUNT[price?.unit_amount] ?? a.plan) : 'free';
            if (!active) a.subscription = null;
            // cancel_at_period_end: plan stays until Stripe sends subscription.deleted at period end.
            a.cancelAt = active && o.cancel_at_period_end ? (o.cancel_at ?? o.current_period_end ?? o.items?.data?.[0]?.current_period_end ?? null) : null;
            // Over the new limit: keep the first N; the rest stay stored so an upgrade restores them.
            return `${a.id} -> ${a.plan} (${o.status ?? 'deleted'})`;
        }
        return null;
    }
}
