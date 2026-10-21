import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../src/server.js';
import { runAll } from '../src/run.js';
import { tmp, icos, fakeWorld, mailbox, listen, post, makeAccount, accounts } from './fixtures/helpers.js';

const ERR_SHAPE = (j) => { assert.equal(typeof j.error?.code, 'string'); assert.equal(typeof j.error?.message, 'string'); assert.deepEqual(Object.keys(j), ['error']); };

async function world({ rate = '1000' } = {}) {
    const dataDir = tmp('swapi-');
    const A = icos(120, 10000000); const B = icos(3, 60000000);
    const a = makeAccount(dataDir, 'pro@a.cz', { plan: 'pro', icos: A, websites: { [A[0]]: 'firma-a.cz' } });
    const b = makeAccount(dataDir, 'pro@b.cz', { plan: 'pro', icos: B });
    const s = makeAccount(dataDir, 'starter@c.cz', { plan: 'starter', icos: icos(2, 70000000) });
    const acct = makeAccount(dataDir, 'ucetni@d.cz', { plan: 'accountant', icos: [B[0]] });
    const acc = accounts(dataDir);
    const keyA = acc.createApiKey(acc.get(a.id), 'erp').key; const keyB = acc.createApiKey(acc.get(b.id)).key;
    const keyD = acc.createApiKey(acc.get(acct.id)).key;
    const cl = acc.addClient(acc.get(acct.id), 'Novák s.r.o.').client; acc.setClientIcos(acc.get(acct.id), cl.id, [A[5], B[0]]);
    const cl2 = acc.addClient(acc.get(acct.id), 'Dvořák a.s.').client; acc.setClientIcos(acc.get(acct.id), cl2.id, [A[6]]);
    // a starter account that had a key from an earlier Pro period
    const sa = acc.get(s.id); sa.plan = 'pro'; const keyS = acc.createApiKey(sa).key; sa.plan = 'starter';
    const revoked = acc.createApiKey(acc.get(a.id), 'old'); acc.revokeApiKey(acc.get(a.id), revoked.id);
    acc.save();
    const { world: w, check } = fakeWorld(); const { mailer } = mailbox();
    let t = Date.parse('2026-10-19T04:30:00Z');
    const now = () => t;
    const loadCoi = async () => ({ entries: [{ domain: 'risky-shop.cz', reason: 'x' }] });
    await runAll({ dataDir, mailer, check, log: () => {}, now, loadCoi }); // baseline
    t = Date.parse('2026-10-20T04:30:00Z'); w.unreliable[A[1]] = 'ANO'; w.unreliable[B[1]] = 'ANO';
    await runAll({ dataDir, mailer, check, log: () => {}, now, loadCoi });
    t = Date.parse('2026-10-21T04:30:00Z'); w.accounts[A[2]] = ['999/0300'];
    await runAll({ dataDir, mailer, check, log: () => {}, now, loadCoi });
    const srv = createServer({ dataDir, env: { API_RATE_PER_MIN: rate, API_BAD_AUTH_PER_MIN: '1000' }, baseUrl: 'https://sw.test', mailer, log: () => {} });
    const url = await listen(srv);
    const get = (p, key, init = {}) => fetch(`${url}${p}`, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) } });
    return { dataDir, url, srv, get, A, B, keyA, keyB, keyD, keyS, revokedKey: revoked.key, clientId: cl.id, a, b };
}

test('API auth: missing, malformed, unknown and revoked keys -> 401 with error JSON', async () => {
    const w = await world();
    try {
        let r = await w.get('/api/v1/suppliers'); assert.equal(r.status, 401); let j = await r.json(); ERR_SHAPE(j); assert.equal(j.error.code, 'missing_api_key');
        assert.match(r.headers.get('www-authenticate'), /^Bearer/); assert.match(r.headers.get('content-type'), /application\/json/); assert.equal(r.headers.get('cache-control'), 'no-store');
        r = await fetch(`${w.url}/api/v1/suppliers`, { headers: { authorization: `Basic ${w.keyA}` } }); j = await r.json(); assert.equal(r.status, 401); assert.equal(j.error.code, 'invalid_api_key');
        r = await w.get('/api/v1/suppliers', 'sw_' + 'x'.repeat(32)); j = await r.json(); assert.equal(r.status, 401); assert.equal(j.error.code, 'invalid_api_key');
        r = await w.get('/api/v1/suppliers', w.keyA.slice(0, -1) + (w.keyA.endsWith('A') ? 'B' : 'A')); assert.equal(r.status, 401);
        r = await w.get('/api/v1/suppliers', 'not-a-key'); assert.equal(r.status, 401);
        r = await w.get('/api/v1/suppliers', w.revokedKey); j = await r.json(); assert.equal(r.status, 401); assert.equal(j.error.code, 'revoked_api_key');
        r = await w.get('/api/v1/suppliers', w.keyA); assert.equal(r.status, 200);
    } finally { w.srv.close(); }
});

test('API keys are stored hashed only; revoking via the store stops a working key immediately', async () => {
    const w = await world();
    try {
        const raw = new DatabaseSync(path.join(w.dataDir, 'accounts.db')).prepare('SELECT data FROM accounts').all().map((r) => r.data).join('\n');
        for (const k of [w.keyA, w.keyB, w.keyD, w.keyS]) assert.ok(!raw.includes(k), 'plaintext key must not be stored');
        assert.match(raw, /"hash":"[0-9a-f]{64}"/);
        assert.equal((await w.get('/api/v1/account', w.keyB)).status, 200);
        const acc = accounts(w.dataDir); const b = acc.get(w.b.id); acc.revokeApiKey(b, b.apiKeys[0].id); acc.save();
        const r = await w.get('/api/v1/account', w.keyB); assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'revoked_api_key');
    } finally { w.srv.close(); }
});

test('API plan gating: starter key -> 403 plan_required; clients endpoint only for Accountant', async () => {
    const w = await world();
    try {
        let r = await w.get('/api/v1/suppliers', w.keyS); let j = await r.json(); assert.equal(r.status, 403); ERR_SHAPE(j); assert.equal(j.error.code, 'plan_required');
        r = await w.get('/api/v1/clients', w.keyA); j = await r.json(); assert.equal(r.status, 403); assert.equal(j.error.code, 'plan_required');
        r = await w.get('/api/v1/clients', w.keyD); j = await r.json(); assert.equal(r.status, 200);
        assert.deepEqual(j.data.map((c) => [c.name, c.suppliers]), [['Novák s.r.o.', 2], ['Dvořák a.s.', 1]]);
        // creating a key on a non-API plan is refused
        const acc = accounts(w.dataDir); assert.match(acc.createApiKey(acc.byEmail('starter@c.cz')).error, /Pro or Accountant/);
    } finally { w.srv.close(); }
});

test('API rate limit per key: 429 with Retry-After and rate headers; other keys unaffected', async () => {
    const w = await world({ rate: '3' });
    try {
        for (let i = 0; i < 3; i++) { const r = await w.get('/api/v1/account', w.keyA); assert.equal(r.status, 200); assert.equal(r.headers.get('x-ratelimit-limit'), '3'); assert.equal(r.headers.get('x-ratelimit-remaining'), String(2 - i)); }
        const r = await w.get('/api/v1/account', w.keyA); assert.equal(r.status, 429); const j = await r.json(); ERR_SHAPE(j); assert.equal(j.error.code, 'rate_limited');
        assert.ok(Number(r.headers.get('retry-after')) >= 1);
        assert.equal((await w.get('/api/v1/account', w.keyB)).status, 200);
    } finally { w.srv.close(); }
});

test('API: repeated bad keys from one IP are throttled', async () => {
    const dataDir = tmp('swapi2-');
    const srv = createServer({ dataDir, env: { API_BAD_AUTH_PER_MIN: '3' }, mailer: mailbox().mailer, log: () => {} }); const url = await listen(srv);
    try {
        const codes = []; for (let i = 0; i < 5; i++) codes.push((await fetch(`${url}/api/v1/suppliers`, { headers: { authorization: 'Bearer sw_' + 'y'.repeat(30) } })).status);
        assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    } finally { srv.close(); }
});

test('API pagination: limit/offset/total/next_offset and parameter validation', async () => {
    const w = await world();
    try {
        let j = await (await w.get('/api/v1/suppliers', w.keyA)).json();
        assert.equal(j.pagination.total, 120); assert.equal(j.pagination.limit, 50); assert.equal(j.data.length, 50); assert.equal(j.pagination.next_offset, 50);
        const seen = new Set(); let off = 0;
        while (off !== null) { j = await (await w.get(`/api/v1/suppliers?limit=45&offset=${off}`, w.keyA)).json(); j.data.forEach((s) => seen.add(s.ico)); off = j.pagination.next_offset; }
        assert.equal(seen.size, 120); assert.deepEqual([...seen].sort(), [...w.A].sort());
        j = await (await w.get('/api/v1/suppliers?limit=200&offset=100', w.keyA)).json(); assert.equal(j.data.length, 20); assert.equal(j.pagination.next_offset, null);
        j = await (await w.get('/api/v1/suppliers?offset=500', w.keyA)).json(); assert.equal(j.data.length, 0); assert.equal(j.pagination.next_offset, null);
        for (const q of ['limit=0', 'limit=201', 'limit=abc', 'limit=1.5', 'offset=-1', 'offset=x', 'status=bogus']) {
            const r = await w.get(`/api/v1/suppliers?${q}`, w.keyA); assert.equal(r.status, 400, q); const e = await r.json(); ERR_SHAPE(e); assert.equal(e.error.code, 'invalid_parameter');
        }
    } finally { w.srv.close(); }
});

test('API data: supplier results, single supplier, alerts since, status filter', async () => {
    const w = await world();
    try {
        let r = await w.get(`/api/v1/suppliers/${w.A[1]}`, w.keyA); let j = await r.json(); assert.equal(r.status, 200);
        assert.equal(j.data.ico, w.A[1]); assert.equal(j.data.name, `Firma ${w.A[1]} s.r.o.`); assert.equal(j.data.status, 'alert');
        assert.equal(j.data.checks.vat.status, 'alert'); assert.equal(j.data.checks.isir.status, 'ok'); assert.deepEqual(j.data.alerts, ['UNRELIABLE_VAT_PAYER']); assert.equal(j.data.last_checked, '2026-10-21T04:30:00.000Z');
        j = await (await w.get(`/api/v1/suppliers/${w.A[0]}`, w.keyA)).json(); assert.equal(j.data.website, 'firma-a.cz'); assert.equal(j.data.status, 'ok'); assert.equal(j.data.checks.coi.status, 'ok'); assert.equal(j.data.checks.coi.detail, 'firma-a.cz not listed');
        j = await (await w.get(`/api/v1/suppliers/${w.A[3]}`, w.keyA)).json(); assert.equal(j.data.checks.coi.status, 'not_run');
        j = await (await w.get(`/api/v1/suppliers/${w.A[2]}`, w.keyA)).json(); assert.equal(j.data.checks.accounts.status, 'alert'); assert.deepEqual(j.data.changes.map((c) => c.type).sort(), ['BANK_ACCOUNT_ADDED', 'BANK_ACCOUNT_REMOVED']);
        r = await w.get('/api/v1/suppliers/12345678', w.keyA); assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'invalid_ico');
        r = await w.get('/api/v1/suppliers/abc', w.keyA); assert.equal(r.status, 400);
        j = await (await w.get('/api/v1/suppliers?status=alert', w.keyA)).json(); assert.deepEqual(j.data.map((s) => s.ico).sort(), [w.A[1], w.A[2]].sort()); assert.equal(j.pagination.total, 2);
        j = await (await w.get('/api/v1/suppliers?status=ok&limit=200', w.keyA)).json(); assert.equal(j.pagination.total, 118);
        // alerts: the 20th has the unreliable flag (and stays on the 21st); since the 21st only the 21st records
        j = await (await w.get('/api/v1/alerts?since=2026-10-01', w.keyA)).json();
        assert.ok(j.data.length >= 3); assert.ok(j.data.every((x, i, arr) => i === 0 || arr[i - 1].at >= x.at), 'newest first');
        assert.ok(j.data.some((x) => x.ico === w.A[1] && x.at === '2026-10-20T04:30:00.000Z' && x.alerts.includes('UNRELIABLE_VAT_PAYER')));
        const since21 = await (await w.get('/api/v1/alerts?since=2026-10-21T00:00:00Z', w.keyA)).json();
        assert.ok(since21.data.every((x) => x.at >= '2026-10-21')); assert.ok(since21.data.some((x) => x.ico === w.A[2]));
        for (const q of ['since=yesterday', 'since=2026-13-45', 'since=2001-01-01']) { const e = await w.get(`/api/v1/alerts?${q}`, w.keyA); assert.equal(e.status, 400, q); ERR_SHAPE(await e.json()); }
        j = await (await w.get('/api/v1/account', w.keyA)).json(); assert.deepEqual(j.data, { email: 'pro@a.cz', plan: 'pro', supplier_limit: 500, suppliers: 120, clients: null, api_version: 'v1' });
    } finally { w.srv.close(); }
});

test('API: no cross-account data leakage', async () => {
    const w = await world();
    try {
        // B cannot see A's supplier, list contains only B's
        let r = await w.get(`/api/v1/suppliers/${w.A[1]}`, w.keyB); assert.equal(r.status, 404); assert.equal((await r.json()).error.code, 'not_found');
        let j = await (await w.get('/api/v1/suppliers?limit=200', w.keyB)).json(); assert.deepEqual(j.data.map((s) => s.ico).sort(), [...w.B].sort()); assert.equal(j.pagination.total, 3);
        j = await (await w.get('/api/v1/alerts?since=2026-10-01&limit=200', w.keyB)).json(); assert.ok(j.data.length > 0); assert.ok(j.data.every((x) => w.B.includes(x.ico)));
        j = await (await w.get('/api/v1/alerts?since=2026-10-01&limit=200', w.keyA)).json(); assert.ok(j.data.every((x) => w.A.includes(x.ico)));
        // the accountant watches A[5] for a client: sees it, with the client, but A's other suppliers stay invisible
        j = await (await w.get(`/api/v1/suppliers/${w.A[5]}`, w.keyD)).json(); assert.equal(j.data.client.name, 'Novák s.r.o.');
        assert.equal((await w.get(`/api/v1/suppliers/${w.A[1]}`, w.keyD)).status, 404);
        j = await (await w.get('/api/v1/suppliers?limit=200', w.keyD)).json(); assert.deepEqual(j.data.map((s) => `${s.client?.name ?? '-'}:${s.ico}`).sort(), [`-:${w.B[0]}`, `Dvořák a.s.:${w.A[6]}`, `Novák s.r.o.:${w.A[5]}`, `Novák s.r.o.:${w.B[0]}`].sort());
        assert.ok(j.data.every((s) => !JSON.stringify(s).includes('pro@a.cz') && !JSON.stringify(s).includes('pro@b.cz')));
        // B[0] is on two of D's lists: also_in; client filter picks one; foreign client ids are 404
        j = await (await w.get(`/api/v1/suppliers/${w.B[0]}`, w.keyD)).json(); assert.equal(j.also_in.length, 1);
        j = await (await w.get(`/api/v1/suppliers?client=${w.clientId}`, w.keyD)).json(); assert.equal(j.pagination.total, 2);
        j = await (await w.get('/api/v1/suppliers?client=main', w.keyD)).json(); assert.deepEqual(j.data.map((s) => s.ico), [w.B[0]]);
        assert.equal((await w.get(`/api/v1/suppliers?client=${w.clientId}`, w.keyA)).status, 404);
        assert.equal((await w.get('/api/v1/suppliers?client=cl_000000000000', w.keyD)).status, 404);
    } finally { w.srv.close(); }
});

test('API: read-only, unknown endpoints, HEAD, sources', async () => {
    const w = await world();
    try {
        for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await w.get('/api/v1/suppliers', w.keyA, { method: m }); assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'GET, HEAD'); ERR_SHAPE(await r.json()); }
        for (const p of ['/api/v2/suppliers', '/api/v1/nope', '/api/v1/alerts/123', '/api']) { const r = await w.get(p, w.keyA); assert.equal(r.status, 404, p); ERR_SHAPE(await r.json()); }
        const h = await w.get('/api/v1/account', w.keyA, { method: 'HEAD' }); assert.equal(h.status, 200); assert.equal(await h.text(), '');
        const s = await (await w.get('/api/v1/sources', w.keyA)).json(); assert.ok('data' in s);
    } finally { w.srv.close(); }
});

test('manage page: create key (shown once), list prefix, revoke; key works then stops', async () => {
    const w = await world();
    try {
        const acc = accounts(w.dataDir); const t = acc.issue(w.b.id, 'manage'); acc.save();
        let html = await (await post(`${w.url}/manage`, { t, action: 'create_key', label: 'ERP sync' })).text();
        const key = html.match(/<code>(sw_[\w-]+)<\/code>/)[1]; assert.match(html, /shown only once/); assert.match(html, /ERP sync/);
        assert.equal((await w.get('/api/v1/account', key)).status, 200);
        html = await (await fetch(`${w.url}/manage?t=${t}`)).text(); assert.ok(!html.includes(key), 'key not shown again'); assert.ok(html.includes(key.slice(0, 7)));
        const id = accounts(w.dataDir).get(w.b.id).apiKeys.find((k) => k.label === 'ERP sync').id;
        html = await (await post(`${w.url}/manage`, { t, action: 'revoke_key', key: id })).text(); assert.match(html, /API key revoked/);
        assert.equal((await w.get('/api/v1/account', key)).status, 401);
        // free/starter accounts see no key form
        const s = acc.byEmail('starter@c.cz');
        const acc3 = accounts(w.dataDir); const ts2 = acc3.issue(s.id, 'manage'); acc3.save();
        html = await (await fetch(`${w.url}/manage?t=${ts2}`)).text(); assert.ok(!html.includes('Create API key')); assert.match(html, /included with Pro and Accountant/);
    } finally { w.srv.close(); }
});
