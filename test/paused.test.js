import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { monitoringEnabled, sitePage, writeSite } from '../src/site.js';
import { Updates } from '../src/updates.js';
import { runHealth, PROBE_HEADER, readHealth } from '../src/health.js';
import { renderResult } from '../src/freecheck.js';
import { runAll } from '../src/run.js';
import { tmp, listen, post, mailbox, makeAccount, accounts } from './fixtures/helpers.js';

const PAUSED = { SIGNUPS_ENABLED: 'false' };
const site = (f) => fs.readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8');
const updates = (dataDir) => new Updates(path.join(dataDir, 'accounts.json'));
// Free check stub: the real one needs the registers (see freecheck.test.js).
const freeCheck = async (req, form, page) => [200, page('Check', `<h1>Firma · IČO ${form.ico ?? ''}</h1>`)];
function setup(env = {}, opts = {}) {
    const dataDir = tmp('swpause-'); const { sent, mailer } = mailbox();
    const srv = createServer({ env, dataDir, baseUrl: 'https://sw.test', mailer, log: () => {}, freeCheck, ...opts });
    return { dataDir, sent, mailer, srv };
}
const linkIn = (m, p, k) => m.text.match(new RegExp(`https://sw\\.test${p}\\?${k}=([\\w-]+)`))[1];

test('the switch: on unless SIGNUPS_ENABLED is false/0/no/off', () => {
    assert.equal(monitoringEnabled({}), true); assert.equal(monitoringEnabled({ SIGNUPS_ENABLED: 'true' }), true);
    for (const v of ['false', 'FALSE', '0', 'no', 'off', ' false ']) assert.equal(monitoringEnabled({ SIGNUPS_ENABLED: v }), false, v);
});

test('pages: the paused variant drops sign-up, pricing, plans and API links; the monitoring variant drops the updates form', () => {
    const files = ['index.html', 'about.html', 'sources.html', 'api.html', 'guides/index.html', 'guides/how-to-check-a-czech-supplier.html', 'guides/doing-business-with-czech-suppliers.html', 'guides/czech-vat-liability-unreliable-payer-bank-accounts.html'];
    for (const f of files) {
        const off = sitePage(site(f), false); const on = sitePage(site(f), true);
        assert.doesNotMatch(off + on, /<!--(if|end)/, f);
        assert.doesNotMatch(off, /#signup|#pricing|Start free|up to 5 suppliers|\/ month|daily log/, f);
        assert.doesNotMatch(off.split('<footer')[1], /api\.html/, f);
        assert.match(on.split('<footer')[1], /href="\/api.html"/, f);
    }
    const off = sitePage(site('index.html'), false); const on = sitePage(site('index.html'), true);
    assert.match(off, /Ongoing monitoring is currently paused\. The free one-off check is available\./);
    assert.match(off, /id="updates"[\s\S]*action="\/signup"[\s\S]*name="updates" value="1"[\s\S]*name="consent"/);
    assert.match(off, /href="\/check.html"/);
    assert.doesNotMatch(on, /id="updates"|name="updates"/);
    assert.match(on, /name="updates_optin"/); assert.match(on, /190 Kč \/ month/);
});

test('writeSite renders every page for the setting into the served directory', () => {
    const src = tmp('swsrc-'); const dest = tmp('swdest-');
    fs.mkdirSync(path.join(src, 'g')); fs.writeFileSync(path.join(src, 'g', 'a.html'), 'x<!--if monitoring-->M<!--end--><!--if paused-->P<!--end-->'); fs.writeFileSync(path.join(src, 'b.png'), 'bin');
    assert.equal(writeSite(src, dest, false), 2);
    assert.equal(fs.readFileSync(path.join(dest, 'g', 'a.html'), 'utf8'), 'xP'); assert.equal(fs.readFileSync(path.join(dest, 'b.png'), 'utf8'), 'bin');
    writeSite(src, dest, true); assert.equal(fs.readFileSync(path.join(dest, 'g', 'a.html'), 'utf8'), 'xM');
    assert.deepEqual(fs.readdirSync(dest).sort(), ['b.png', 'g']); // no .tmp left behind
    const link = path.join(tmp('swlink-'), 'public'); fs.symlinkSync(src, link);
    for (const d of [src, link, path.join(src, 'g'), path.dirname(src)]) assert.throws(() => writeSite(src, d, false), /overlaps/, d);
    assert.match(fs.readFileSync(path.join(src, 'g', 'a.html'), 'utf8'), /<!--if paused-->/, 'sources untouched');
});

test('paused: sign-up, confirm, manage, billing and the API answer "paused"; free check, account unsubscribe and healthz stay', async () => {
    const { dataDir, sent, srv } = setup(PAUSED); const url = await listen(srv);
    try {
        const a = makeAccount(dataDir, 'old@firma.cz', { icos: ['27082440'] });
        assert.match(await (await fetch(`${url}/`)).text(), /name="updates"/);
        const s = await post(`${url}/signup`, { email: 'x@firma.cz', consent: 'yes', ico: '27082440' });
        assert.equal(s.status, 503); assert.match(await s.text(), /Monitoring is paused/);
        assert.equal(accounts(dataDir).byEmail('x@firma.cz'), null);
        for (const [m, p] of [['GET', '/manage?t=x'], ['POST', '/manage'], ['POST', '/manage-link'], ['POST', '/billing'], ['GET', '/confirm?t=x'], ['POST', '/confirm?t=x']]) assert.equal((await fetch(`${url}${p}`, { method: m, body: m === 'POST' ? 'email=old%40firma.cz' : undefined })).status, 503, `${m} ${p}`);
        const api = await fetch(`${url}/api/v1/suppliers`, { headers: { authorization: 'Bearer sw_x' } });
        assert.equal(api.status, 503); assert.equal((await api.json()).error.code, 'paused');
        assert.match(await (await post(`${url}/manage-link?freecheck=1`, { ico: '27082440' })).text(), /IČO 27082440/);
        const h = await (await fetch(`${url}/healthz?detail=1`)).json(); assert.equal(h.monitoring, false);
        assert.equal((await post(`${url}/unsubscribe?t=${a.unsubToken}`, '')).status, 200); assert.ok(accounts(dataDir).get(a.id).unsubscribed);
        assert.equal(sent.length, 0);
    } finally { srv.close(); }
});

test('updates list: double opt-in, scanner-safe confirm, one-click unsubscribe deletes the address', async () => {
    const { dataDir, sent, srv } = setup(PAUSED); const url = await listen(srv);
    try {
        assert.equal((await post(`${url}/signup`, { updates: '1', email: 'u@firma.cz' })).status, 400, 'consent required');
        assert.equal((await post(`${url}/signup`, { updates: '1', email: 'nope', consent: 'yes' })).status, 400);
        const r = await post(`${url}/signup`, { updates: '1', email: 'U@Firma.cz', consent: 'yes' });
        assert.equal(r.status, 200); assert.match(await r.text(), /Check your email/);
        assert.equal(sent.length, 1); assert.equal(sent[0].to, 'u@firma.cz'); assert.match(sent[0].unsubscribeUrl, /\/unsubscribe\?u=/);
        assert.equal(updates(dataDir).confirmed().length, 0);
        const u = linkIn(sent[0], '/confirm', 'u');
        assert.match(await (await fetch(`${url}/confirm?u=${u}`)).text(), /<form method="post"/);
        assert.equal(updates(dataDir).confirmed().length, 0, 'GET does not confirm');
        assert.equal((await post(`${url}/confirm?u=${u}`, '')).status, 200);
        assert.deepEqual(updates(dataDir).confirmed().map((x) => x.email), ['u@firma.cz']);
        assert.equal((await post(`${url}/confirm?u=${u}`, '')).status, 400, 'single use');
        await post(`${url}/signup`, { updates: '1', email: 'u@firma.cz', consent: 'yes' });
        assert.equal(sent.length, 1, 'already on the list: no second confirm mail');
        const unsub = sent[0].unsubscribeUrl.split('u=')[1];
        assert.equal((await fetch(`${url}/unsubscribe?u=${unsub}`)).status, 200); assert.equal(updates(dataDir).confirmed().length, 1, 'GET does not unsubscribe');
        assert.equal((await post(`${url}/unsubscribe?u=${unsub}`, 'List-Unsubscribe=One-Click')).status, 200);
        assert.equal(updates(dataDir).get('u@firma.cz'), null);
    } finally { srv.close(); }
});

test('updates list: unconfirmed requests expire (48 h link) and are purged after 7 days', () => {
    const dataDir = tmp('swupd-'); let t = Date.parse('2026-10-01T00:00:00Z');
    const up = new Updates(path.join(dataDir, 'accounts.json'), { now: () => t });
    const { confirmToken } = up.request('late@firma.cz'); up.request('keep@firma.cz'); up.addConfirmed('acc@firma.cz');
    t += 49 * 3600e3; assert.equal(up.confirm(confirmToken), null);
    t += 6 * 864e5; assert.equal(up.purgeUnconfirmed(), 2);
    assert.deepEqual(up.confirmed().map((x) => x.email), ['acc@firma.cz']);
});

test('monitoring sign-up with the updates box ticked joins the updates list when the account is confirmed', async () => {
    const { dataDir, sent, srv } = setup(); const url = await listen(srv);
    try {
        await post(`${url}/signup`, { email: 'a@firma.cz', consent: 'yes', ico: '27082440', updates_optin: 'yes' });
        await post(`${url}/signup`, { email: 'b@firma.cz', consent: 'yes', ico: '27082440' });
        assert.equal(updates(dataDir).confirmed().length, 0);
        for (const m of sent) assert.equal((await post(`${url}/confirm`, `t=${linkIn(m, '/confirm', 't')}`)).status, 200);
        assert.deepEqual(updates(dataDir).confirmed().map((x) => [x.email, x.source]), [['a@firma.cz', 'signup']]);
        assert.equal(accounts(dataDir).byEmail('a@firma.cz').updatesOptIn, undefined);
        // the updates form also works while monitoring is on
        assert.equal((await post(`${url}/signup`, { updates: '1', email: 'c@firma.cz', consent: 'yes' })).status, 200);
    } finally { srv.close(); }
});

test('health probes (secret header) are validated but store nothing, send nothing and skip rate limits', async () => {
    for (const env of [{}, PAUSED]) {
        const { dataDir, sent, srv } = setup({ ...env, MAIL_FORM_PER_IP: '1' }); const url = await listen(srv);
        try {
            const h = { [PROBE_HEADER]: srv.healthToken };
            for (let i = 0; i < 3; i++) {
                const r = await post(`${url}/signup`, monitoringEnabled(env) ? { email: 'p@firma.cz', consent: 'yes', ico: '27082440' } : { updates: '1', email: 'p@firma.cz', consent: 'yes' }, h);
                assert.equal(r.status, 200); assert.match(await r.text(), /Check your email/);
            }
            assert.equal(sent.length, 0); assert.equal(accounts(dataDir).byEmail('p@firma.cz'), null); assert.equal(updates(dataDir).get('p@firma.cz'), null);
            assert.equal((await post(`${url}/signup`, { updates: '1', email: 'p@firma.cz', consent: 'yes' }, { [PROBE_HEADER]: 'guess' })).status, 200);
            assert.equal(sent.length, 1, 'a wrong token is an ordinary request');
        } finally { srv.close(); }
    }
});

test('runHealth: emails a new failure once, a changed failure set, and the recovery; status in health.json', async () => {
    const { dataDir, srv } = setup(PAUSED); const url = await listen(srv);
    const { sent, mailer } = mailbox(); let smtpOk = true; mailer.verify = async () => { if (!smtpOk) throw new Error('auth failed'); return { ok: true }; };
    const run = (env = PAUSED) => runHealth({ env: { ...env, HEALTH_EMAIL: 'me@example.org' }, dataDir, baseUrl: url, token: srv.healthToken, mailer, log: () => {} });
    try {
        let st = await run(); assert.equal(st.ok, true, JSON.stringify(st.probes)); assert.equal(sent.length, 0);
        smtpOk = false; st = await run();
        assert.deepEqual(st.failed, ['smtp']); assert.equal(sent.length, 1); assert.equal(sent[0].to, 'me@example.org'); assert.match(sent[0].subject, /FAILED \(SMTP login\)/); assert.match(sent[0].text, /auth failed/);
        await run(); assert.equal(sent.length, 1, 'same failure next hour: no repeat');
        st = await run({}); // site in the wrong variant for the setting, and sign-up probe aimed at the wrong form
        assert.ok(st.failed.includes('home')); assert.equal(sent.length, 2);
        smtpOk = true; st = await run(); assert.equal(st.ok, true); assert.equal(sent.length, 3); assert.match(sent[2].subject, /OK again/);
        assert.equal(readHealth(dataDir).ok, true);
        assert.equal((await (await fetch(`${url}/healthz?detail=1`)).json()).health.ok, true);
        const dry = await runHealth({ env: PAUSED, dataDir, baseUrl: url, token: srv.healthToken, mailer: { send: async () => {}, verify: async () => ({ dry: true }) }, log: () => {} });
        assert.deepEqual(dry.failed, ['smtp']); assert.match(dry.probes.smtp.error, /not configured/);
        const unreachable = await runHealth({ env: PAUSED, dataDir: tmp(), baseUrl: 'http://127.0.0.1:9', token: 'x', mailer, log: () => {} });
        assert.deepEqual(unreachable.failed, ['home', 'signup', 'freecheck']);
    } finally { srv.close(); }
});

test('free check result: paused points to the updates list instead of the monitoring sign-up', () => {
    const r = { ico: '27082440', ares: { found: true, name: 'Alza.cz a.s.' }, vat: null, isir: null, sourceErrors: [], checkedAt: Date.now() };
    assert.match(renderResult(r, { coiUsed: false }), /href="\/#signup"/);
    const off = renderResult(r, { coiUsed: false, monitoring: false });
    assert.match(off, /href="\/#updates"/); assert.doesNotMatch(off, /#signup|5 suppliers/);
});

test('daily run while paused: self-check and housekeeping only, no customer checks or emails', async () => {
    const dataDir = tmp('swrunp-'); makeAccount(dataDir, 'a@firma.cz', { icos: ['27082440'] });
    let canaryRan = false;
    const s = await runAll({ env: PAUSED, dataDir, mailer: { send: async () => assert.fail('mail') }, check: async () => assert.fail('check'), canary: async () => { canaryRan = true; return { failed: [] }; }, log: () => {} });
    assert.equal(s.paused, true); assert.equal(s.checked, 0); assert.ok(canaryRan);
});
