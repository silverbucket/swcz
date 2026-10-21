import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { createFreeCheck, RateLimiter, clientIp } from '../src/freecheck.js';
import { Accounts } from '../src/accounts.js';
import { runAll } from '../src/run.js';

// Fake registers that record every request they get.
const registers = (calls = []) => ({
    calls,
    ares: async (ico) => { calls.push(`ares ${ico}`); return { found: true, ico, name: 'Dodavatel s.r.o.', dic: `CZ${ico}`, address: 'Praha 7', dissolved: null }; },
    vr: async () => null,
    dph: async (dics) => { calls.push(`dph ${dics}`); return { generated: 'now', subjects: new Map(dics.map((d) => [d, { dic: d, subjectType: 'PLATCE_DPH', unreliable: 'ANO', accounts: ['123-456/0100'] }])) }; },
    isir: async (ico) => { calls.push(`isir ${ico}`); return { cases: [] }; },
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'swfc-'));
const coiList = { entries: [{ domain: 'bad-shop.cz', reason: 'nekontaktní', listedOn: '2026-01-01' }] };

async function withServer(fc, fn) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swfree-'));
    const srv = createServer({ dataDir, secret: 'x', mailer: { send: async () => {} }, log: () => {}, freeCheck: fc });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try { await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}
const post = (url, data, ip = '1.1.1.1') => fetch(`${url}/manage-link?freecheck=1`, { method: 'POST', body: new URLSearchParams(data), headers: { 'x-forwarded-for': `${ip}, 127.0.0.1` } });

test('rate limiter: per IP and global caps, window expiry', () => {
    let t = 0; const l = new RateLimiter({ perIp: 2, global: 3, windowMs: 1000, now: () => t });
    assert.ok(l.allow('a')); assert.ok(l.allow('a')); assert.equal(l.allow('a'), false);
    assert.ok(l.allow('b')); assert.equal(l.allow('c'), false, 'global cap');
    t = 1001; assert.ok(l.allow('a'));
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 127.0.0.1' } }), '9.9.9.9');
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' } }), '9.9.9.9', 'client-supplied entries are ignored');
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9, 10.0.0.2' } }), '9.9.9.9');
});

test('GET /check shows the form; invalid IČO and website rejected without running checks', async () => {
    const calls = []; const fc = createFreeCheck({ env: {}, dataDir: tmpDir(), sources: registers(calls), loadCoi: async () => coiList });
    await withServer(fc, async (url) => {
        const g = await fetch(`${url}/check`); const h = await g.text();
        assert.equal(g.status, 200); assert.match(h, /name="ico"/); assert.match(h, /meta name="description"/); assert.doesNotMatch(h, /noindex/);
        assert.equal((await post(url, { ico: '12345678' })).status, 400);
        assert.equal((await post(url, { ico: '27082440', web: 'not a domain' })).status, 400);
        assert.equal(calls.length, 0);
    });
});

test('POST /check runs the checks once, shows warnings, ČOI match and signup CTA', async () => {
    const calls = []; const fc = createFreeCheck({ env: {}, dataDir: tmpDir(), sources: registers(calls), loadCoi: async () => coiList });
    await withServer(fc, async (url) => {
        const r = await post(url, { ico: '27082440', web: 'https://www.bad-shop.cz/x' }); const h = await r.text();
        assert.equal(r.status, 200); assert.deepEqual(calls, ['ares 27082440', 'dph 27082440', 'isir 27082440']); assert.match(h, /bad-shop\.cz - nekontaktní/);
        assert.match(h, /Dodavatel s\.r\.o\./); assert.match(h, /UNRELIABLE VAT PAYER/); assert.match(h, /123-456\/0100/);
        assert.match(h, /ČOI list of risky e-shops/); assert.match(h, /Česká obchodní inspekce/); assert.match(h, /href="\/#signup"/); assert.match(h, /not legal or tax advice/);
        const r2 = await post(url, { ico: '6947' }); assert.equal(r2.status, 200); assert.doesNotMatch(await r2.text(), /ČOI risky e-shops \(/, 'no website: no ČOI row');
    });
});

test('POST /check is rate-limited per IP; honeypot does not run checks', async () => {
    const calls = []; const fc = createFreeCheck({ env: {}, dataDir: tmpDir(), sources: registers(calls), loadCoi: async () => null, limiter: new RateLimiter({ perIp: 2, global: 100 }) });
    await withServer(fc, async (url) => {
        assert.equal((await post(url, { ico: '27082440' })).status, 200);
        assert.equal((await post(url, { ico: '09970207' })).status, 200);
        assert.equal((await post(url, { ico: '45274649' })).status, 429);
        assert.equal((await post(url, { ico: '27082440' })).status, 200, 'already checked today: answered from cache');
        assert.equal((await post(url, { ico: '45274649' }, '2.2.2.2')).status, 200, 'other IP unaffected');
        await post(url, { ico: '27082440', fax: 'x' }, '3.3.3.3');
        assert.equal(calls.filter((c) => c.startsWith('ares')).length, 3, 'three IČO looked up, each once');
    });
});

test('POST /check: answers come from the shared cache; failed requests are retried', async () => {
    let isirUp = false; const reg = registers(); const isir = reg.isir;
    reg.isir = async (ico) => { if (!isirUp) throw new Error('down'); return isir(ico); };
    const fc = createFreeCheck({ env: {}, dataDir: tmpDir(), sources: reg, loadCoi: async () => coiList });
    await withServer(fc, async (url) => {
        assert.match(await (await post(url, { ico: '27082440' })).text(), /did not answer/); isirUp = true;
        await post(url, { ico: '27082440' });
        assert.deepEqual(reg.calls, ['ares 27082440', 'dph 27082440', 'isir 27082440'], 'only the failed ISIR request is repeated');
        const h = await (await post(url, { ico: '27082440', web: 'bad-shop.cz' })).text();
        assert.equal(reg.calls.length, 3, 'all cached'); assert.match(h, /LISTED/);
    });
});

test('free check reuses the daily run answers; the next daily run invalidates them; 36 h backstop', async () => {
    const dataDir = tmpDir(); let t = Date.parse('2026-10-21T04:30:00Z'); const now = () => t;
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    const { confirmToken } = acc.signup('d@x.cz', ['27082440'], { consentText: 'x' }); acc.confirm(confirmToken); acc.save();
    const runReg = registers();
    await runAll({ dataDir, mailer: { send: async () => {} }, sources: runReg, canary: null, log: () => {}, now });
    assert.equal(runReg.calls.length, 3);
    const freeReg = registers(); const fc = createFreeCheck({ env: {}, dataDir, sources: freeReg, loadCoi: async () => null, now, limiter: new RateLimiter({ perIp: 0, global: 0 }) });
    await withServer(fc, async (url) => {
        t += 20 * 3600e3; // next morning, before the daily run
        const r = await post(url, { ico: '27082440' });
        assert.equal(r.status, 200, 'cached: no rate limit'); assert.deepEqual(freeReg.calls, [], 'no register request');
        assert.match(await r.text(), /Register data from 2026-10-21 04:30 UTC/, 'shows when the answer was fetched, not now');
        t += 3600e3; await runAll({ dataDir, mailer: { send: async () => {} }, sources: runReg, canary: null, log: () => {}, now });
        assert.equal(runReg.calls.length, 6, 'the daily run always refreshes');
        t += 37 * 3600e3; // daily run stopped: answers too old
        assert.equal((await post(url, { ico: '27082440' })).status, 429, 'not cached any more, so the limit applies');
    });
});

test('static SEO files: guides, sitemap, robots, internal links', async () => {
    await withServer(createFreeCheck({ env: {}, dataDir: '/tmp', check: async () => ({ rows: [] }) }), async (url) => {
        const sm = await (await fetch(`${url}/sitemap.xml`)).text();
        const locs = [...sm.matchAll(/<loc>https:\/\/supplierwatch\.cz([^<]*)<\/loc>/g)].map((m) => m[1]);
        assert.ok(locs.length >= 6);
        for (const p of locs.filter((p) => p.startsWith('/guides'))) {
            const r = await fetch(`${url}${p}`); const h = await r.text();
            assert.equal(r.status, 200, p); assert.match(h, /<meta name="description" content="[^"]{60,}">/); assert.match(h, /Not legal or tax advice/); assert.match(h, /href="\/check.html"/);
            assert.doesNotMatch(h, /silverbucket/); assert.match(h, /contact@supplierwatch\.cz/);
        }
        const g1 = await (await fetch(`${url}/guides/czech-vat-liability-unreliable-payer-bank-accounts.html`)).text();
        assert.match(g1, /5 Afs 60\/2021/); assert.match(g1, /3 Afs 114\/2018/); assert.match(g1, /no longer applies/);
        assert.match(await (await fetch(`${url}/robots.txt`)).text(), /Sitemap: https:\/\/supplierwatch\.cz\/sitemap\.xml/);
        const home = await (await fetch(`${url}/`)).text(); assert.match(home, /href="\/guides\/"/); assert.match(home, /href="\/check.html"/);
        const st = await (await fetch(`${url}/check.html`)).text(); assert.match(st, /action="\/manage-link\?freecheck=1"/); assert.match(st, /canonical" href="https:\/\/supplierwatch.cz\/check.html/);
    });
});
