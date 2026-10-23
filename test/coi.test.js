import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, decode, normalizeDomain, matchDomain, fetchRiskyWebs } from '../src/sources/coi.js';

const buf = fs.readFileSync(new URL('./fixtures/coi-rizikove-seznam.csv', import.meta.url));

test('decodes CP1250 and parses entries', () => {
    const e = parseCsv(decode(buf));
    assert.equal(e.length, 6);
    assert.equal(e[0].domain, 'clarkscz.cz');
    assert.match(e[0].reason, /^Jako provozovatel webu není uveden nikdo/);
    assert.ok(e.some((x) => x.domain === 'cerd.cz'));
});

test('normalizeDomain and matching', () => {
    assert.equal(normalizeDomain('https://www.Shop.CZ/kontakt?x=1'), 'shop.cz');
    const e = [{ domain: 'clarkscz.cz' }, { domain: 'mistrkutil.com' }];
    assert.equal(matchDomain(e, 'http://www.clarkscz.cz/').length, 1);
    assert.equal(matchDomain(e, 'eshop.mistrkutil.com').length, 1);
    assert.equal(matchDomain(e, 'notclarkscz.cz').length, 0);
    assert.equal(matchDomain(e, '').length, 0);
});

test('fetchRiskyWebs uses injected fetch', async () => {
    const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
    const e = await fetchRiskyWebs({ fetchImpl });
    assert.equal(e.length, 6);
});

// --- wiring into Supplier Watch (0.6.0) ---
import os from 'node:os';
import path from 'node:path';
import { loadCoiList } from '../src/sources/coi.js';
import { parseIcos, normaliseWebsite, Accounts } from '../src/accounts.js';
import { checkWatchlist, facts, changes, currentAlerts } from '../src/check.js';
import { runAll } from '../src/run.js';

const okFetch = async () => ({ ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'swcoi-'));

test('website parsing and validation', () => {
    assert.equal(normaliseWebsite('https://WWW.Firma.cz/kontakt'), 'firma.cz');
    assert.match(normaliseWebsite('žluťoučký.cz'), /^xn--.*\.cz$/);
    for (const bad of ['firma', 'a@b.cz', 'http://', '-x-.cz', 'foo..cz']) assert.equal(normaliseWebsite(bad), null, bad);
    const r = parseIcos('27082440 www.firma.cz/\n45274649\nnotadomain.x1 , 6947 eshop.cz');
    assert.deepEqual(r.icos, ['27082440', '45274649', '00006947']);
    assert.deepEqual(r.websites, { 27082440: 'firma.cz', '00006947': 'eshop.cz' });
    assert.deepEqual(r.invalid, ['notadomain.x1']);
});

test('accounts store websites only for kept suppliers', () => {
    const acc = new Accounts(path.join(tmp(), 'a.json'));
    const { account: a } = acc.signup('x@y.cz', ['27082440', '45274649'], { consentText: 'c', websites: { 27082440: 'firma.cz', 99999999: 'z.cz' } });
    assert.deepEqual(a.websites, { 27082440: 'firma.cz' });
    acc.setIcos(a, ['45274649'], { 45274649: 'b.cz', 27082440: 'firma.cz' });
    assert.deepEqual(a.websites, { 45274649: 'b.cz' });
});

test('loadCoiList caches and falls back; tolerates failure', async () => {
    const dataDir = tmp(); const logs = [];
    const fail = async () => { throw new Error('ECONNREFUSED'); };
    assert.equal(await loadCoiList({ dataDir, minEntries: 1, fetchImpl: fail, log: (m) => logs.push(m) }), null);
    const l = await loadCoiList({ dataDir, minEntries: 1, fetchImpl: okFetch });
    assert.equal(l.entries.length, 6); assert.equal(l.stale, false);
    assert.ok(fs.existsSync(path.join(dataDir, 'coi', 'rizikove-seznam.csv')));
    const c = await loadCoiList({ dataDir, minEntries: 1, fetchImpl: fail });
    assert.equal(c.stale, true); assert.equal(c.entries.length, 6);
    assert.equal(await loadCoiList({ dataDir, minEntries: 1, fetchImpl: fail, now: () => Date.now() + 8 * 86400e3 }), null);
    fs.writeFileSync(path.join(dataDir, 'coi', 'rizikove-seznam.csv'), '\n');
    assert.equal(await loadCoiList({ dataDir, minEntries: 1, fetchImpl: fail }), null, 'an empty cached copy is not used');
});

const fakeSources = { ares: async () => ({ found: true, name: 'Firma s.r.o.' }), dph: async () => ({ generated: 'x', subjects: new Map() }), isir: async () => ({ cases: [] }) };

test('check: listed / delisted / unavailable', async () => {
    const coi = { entries: parseCsv(decode(buf)) };
    const items = [{ ico: '27082440', website: 'www.clarkscz.cz' }, { ico: '45274649', website: 'clean.cz' }, { ico: '00006947' }];
    const day1 = (await checkWatchlist(items, { sources: fakeSources, isirEnabled: false, coi: { entries: [] } })).rows;
    const day2 = (await checkWatchlist(items, { sources: fakeSources, isirEnabled: false, coi })).rows;
    assert.deepEqual(changes(facts(day1[0]), facts(day2[0])), [{ type: 'COI_LISTED', to: 'clarkscz.cz' }]);
    assert.ok(currentAlerts(day2[0]).includes('COI_RISKY_WEBSITE'));
    assert.deepEqual(changes(facts(day1[1]), facts(day2[1])), []);
    assert.deepEqual(changes(facts(day2[0]), facts(day1[0])), [{ type: 'COI_DELISTED', from: 'clarkscz.cz' }]);
    // list unavailable: source error, no change inferred, merged facts keep yesterday's
    const down = await checkWatchlist(items, { sources: fakeSources, isirEnabled: false, coi: null });
    assert.equal(down.errors.coi, 2); assert.match(down.rows[0].sourceErrors.join(), /coi/);
    assert.deepEqual(changes(facts(day2[0]), { ...facts(day2[0]), ...facts(down.rows[0]) }), []);
    // supplier without website never touches ČOI
    assert.equal(day2[2].coi, undefined); assert.equal(day2[2].sourceErrors.length, 0);
});

test('runAll: one download per run, alert email with ČOI credit, failure does not break checks', async () => {
    const dataDir = tmp();
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    for (const [e, w] of [['a@x.cz', 'clarkscz.cz'], ['b@x.cz', 'clarkscz.cz']]) {
        const { account } = acc.signup(e, ['27082440'], { consentText: 'c', websites: { 27082440: w } });
        account.confirmed = true;
    }
    acc.save();
    let loads = 0; let list = { entries: [] };
    const loadCoi = async () => { loads++; return list; };
    const check = (items, o) => checkWatchlist(items, { ...o, sources: fakeSources });
    const sent = []; const mailer = { send: async (m) => { sent.push(m); } };
    const base = { env: {}, dataDir, mailer, check, log: () => {}, isirEnabled: false, loadCoi };
    await runAll(base); // baseline
    assert.equal(loads, 1); assert.equal(sent.length, 0);
    list = { entries: parseCsv(decode(buf)) };
    const s = await runAll(base);
    assert.equal(loads, 2); assert.equal(s.emailed, 2);
    assert.match(sent[0].text, /newly added to the ČOI list/);
    assert.match(sent[0].text, /Zdroj: Česká obchodní inspekce/);
    assert.match(sent[0].text, /licence-otevrenych-dat/);
    assert.match(sent[0].text, /not affiliated with or endorsed by ČOI/);
    // download fails: checks still run, nothing emailed
    const s2 = await runAll({ ...base, loadCoi: async () => null });
    assert.equal(s2.checked, 2); assert.equal(s2.failed, 0); assert.equal(sent.length, 2);
    // removal alerts
    list = { entries: [] };
    await runAll(base);
    assert.match(sent.at(-1).text, /removed from the ČOI list/);
});

test('runAll: ČOI fails the self-check -> the saved list is used and dated; no saved list -> failed', async () => {
    const dataDir = tmp();
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    const { account } = acc.signup('a@x.cz', ['27082440', '45274649'], { consentText: 'c', websites: { 27082440: 'clarkscz.cz', 45274649: 'clean.cz' } });
    account.confirmed = true; acc.save();
    const check = (items, o) => checkWatchlist(items, { ...o, sources: fakeSources });
    const sent = []; const mailer = { send: async (m) => { sent.push(m); } };
    const canary = async () => ({ ok: false, failed: ['coi'] });
    const opts = []; let list = { entries: parseCsv(decode(buf)), fetchedAt: '2026-10-20T04:30:00.000Z', stale: true };
    const loadCoi = async (o) => { opts.push(o); return list; };
    const base = { env: {}, dataDir, mailer, check, log: () => {}, isirEnabled: false, loadCoi, canary };
    await runAll(base);
    assert.equal(opts.length, 1); assert.equal(opts[0].cacheOnly, true, 'no download after a failed self-check');
    const latest = JSON.parse(fs.readFileSync(path.join(dataDir, 'state', `${account.id}.json`), 'utf8')).latest;
    assert.equal(latest['27082440'].checks.coi.status, 'alert'); assert.match(latest['27082440'].checks.coi.detail, /saved list from 2026-10-20/);
    assert.equal(latest['45274649'].checks.coi.status, 'ok');
    assert.match(sent[0].text, /saved copy from 2026-10-20/); assert.doesNotMatch(sent[0].text, /NOT CHECKED/);
    list = null;
    await runAll(base);
    const l2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'state', `${account.id}.json`), 'utf8')).latest;
    assert.equal(l2['45274649'].checks.coi.status, 'failed');
});

test('loadCoiList never uses or caches a partial or garbled list (omitted sites would look delisted)', async () => {
    const dataDir = tmp(); const enc = (t) => async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(t).buffer });
    const full = Array.from({ length: 60 }, (_, i) => `shop${i}.cz;'reason'`).join('\n');
    const good = await loadCoiList({ dataDir, fetchImpl: enc(full) }); assert.equal(good.entries.length, 60);
    const cut = await loadCoiList({ dataDir, fetchImpl: enc(full.split('\n').slice(0, 10).join('\n')) });
    assert.equal(cut.stale, true); assert.equal(cut.entries.length, 60, 'cut-off download rejected, saved copy used');
    const html = await loadCoiList({ dataDir, fetchImpl: enc(Array.from({ length: 60 }, () => '<div>Service unavailable</div>').join('\n')) });
    assert.equal(html.entries.length, 60, 'error page rejected and not cached');
    const text = await loadCoiList({ dataDir, fetchImpl: enc(Array.from({ length: 60 }, (_, i) => `Service unavailable at shop${i}.example.cz`).join('\n')) });
    assert.equal(text.stale, true, 'error text ending in a domain is not a domain');
    const half = await loadCoiList({ dataDir, fetchImpl: enc(full.split('\n').slice(0, 55).join('\n')) });
    assert.equal(half.stale, false, 'a modest shrink is accepted');
    const big = Array.from({ length: 200 }, (_, i) => `shop${i}.cz;'reason'`).join('\n');
    await loadCoiList({ dataDir, fetchImpl: enc(big) });
    const cut2 = await loadCoiList({ dataDir, fetchImpl: enc(big.split('\n').slice(0, 90).join('\n')) });
    assert.equal(cut2.stale, true); assert.equal(cut2.entries.length, 200, 'under half the last good copy: taken as cut off');
    fs.writeFileSync(path.join(dataDir, 'coi', 'rizikove-seznam.csv'), "shop1.cz;'reason'\n");
    assert.equal(await loadCoiList({ dataDir, cacheOnly: true }), null, 'a cut-off saved copy is not used');
});

test('loadCoiList cacheOnly never downloads', async () => {
    const dataDir = tmp(); let fetched = 0; const f = async (...a) => { fetched++; return okFetch(...a); };
    assert.equal(await loadCoiList({ dataDir, minEntries: 1, fetchImpl: f, cacheOnly: true }), null);
    await loadCoiList({ dataDir, minEntries: 1, fetchImpl: f }); assert.equal(fetched, 1);
    const c = await loadCoiList({ dataDir, minEntries: 1, fetchImpl: f, cacheOnly: true });
    assert.equal(fetched, 1); assert.equal(c.stale, true); assert.equal(c.entries.length, 6);
});

test('signup/manage forms accept and show websites', async () => {
    const { createServer } = await import('../src/server.js');
    const dataDir = tmp(); const sent = [];
    const srv = createServer({ dataDir, secret: 's', baseUrl: 'https://sw.test', mailer: { send: async (m) => { sent.push(m); } }, log: () => {} });
    const url = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
    try {
        const home = await (await fetch(`${url}/`)).text();
        assert.match(home, /Zdroj: Česká obchodní inspekce/); assert.match(home, /licence-otevrenych-dat/);
        await fetch(`${url}/signup`, { method: 'POST', body: new URLSearchParams({ email: 'w@x.cz', icos: '27082440 https://www.firma.cz/', consent: 'yes' }) });
        const ct = sent[0].text.match(/confirm\?t=([\w-]+)/)[1];
        const html = await (await fetch(`${url}/confirm`, { method: 'POST', body: new URLSearchParams({ t: ct }) })).text();
        assert.match(html, /27082440 firma\.cz/);
        const mt = html.match(/name="t" value="([\w-]+)"/)[1];
        await fetch(`${url}/manage`, { method: 'POST', body: new URLSearchParams({ t: mt, icos: '27082440 shop.cz' }) });
        assert.deepEqual(new Accounts(path.join(dataDir, 'accounts.json')).byEmail('w@x.cz').websites, { 27082440: 'shop.cz' });
    } finally { srv.close(); }
});
