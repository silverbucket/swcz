import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { Accounts, parseIcos } from '../src/accounts.js';
import { runAll } from '../src/run.js';

const SECRET = 'whsec_app';
const sign = (b) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${b}`).digest('hex')}`; };
const VALID = ['27082440', '09970207', '00006947', '45274649', '25596641', '26185610', '47114983'].filter((i) => parseIcos(i).icos.length);

function setup() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swapp-'));
    const sent = [];
    const mailer = { send: async (m) => { sent.push(m); } };
    const srv = createServer({ dataDir, secret: SECRET, baseUrl: 'https://sw.test', mailer, log: () => {} });
    return { dataDir, sent, mailer, srv };
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const post = (url, data, headers = {}) => fetch(url, { method: 'POST', body: typeof data === 'string' ? data : new URLSearchParams(data), headers, redirect: 'manual' });
const linkIn = (m, p) => m.text.match(new RegExp(`https://sw\\.test${p}\\?t=([\\w-]+)`))[1];

test('IČO parsing', () => {
    const r = parseIcos('27082440, 6947\n12345678 abc 27082440');
    assert.deepEqual(r.icos, ['27082440', '00006947']);
    assert.deepEqual(r.invalid, ['12345678', 'abc']);
    assert.ok(VALID.length >= 6, 'need >5 valid fixtures');
});

test('signup -> double opt-in -> manage -> Stripe upgrade -> unsubscribe', async () => {
    const { dataDir, sent, srv } = setup(); const url = await listen(srv);
    try {
        // site + legal pages served
        assert.match(await (await fetch(`${url}/`)).text(), /action="\/signup"/);
        assert.match(await (await fetch(`${url}/terms.html`)).text(), /Terms/);
        assert.equal((await fetch(`${url}/../package.json`)).status, 404);
        // consent required
        assert.equal((await post(`${url}/signup`, { email: 'a@firma.cz', icos: VALID[0] })).status, 400);
        assert.equal(sent.length, 0);
        const r = await post(`${url}/signup`, { email: 'A@Firma.cz', icos: VALID.join('\n'), consent: 'yes' });
        assert.equal(r.status, 200); assert.match(await r.text(), /first 5 were kept/);
        assert.equal(sent.length, 1); assert.equal(sent[0].to, 'a@firma.cz'); assert.ok(sent[0].unsubscribeUrl);
        let acc = new Accounts(path.join(dataDir, 'accounts.json'));
        const a = acc.byEmail('a@firma.cz');
        assert.equal(a.confirmed, false); assert.equal(a.icos.length, 5);
        // not confirmed -> not checked
        assert.equal((await runAll({ dataDir, mailer: { send: async () => assert.fail('mail') }, check: async () => assert.fail('check'), log: () => {} })).checked, 0);
        // confirm (single use)
        const ct = linkIn(sent[0], '/confirm');
        assert.match(await (await fetch(`${url}/confirm?t=${ct}`)).text(), /method="post" action="\/confirm"/); // GET (link scanners) only shows a button
        const c = await post(`${url}/confirm`, { t: ct }); assert.equal(c.status, 200);
        const html = await c.text(); assert.match(html, /client_reference_id=acc_/); assert.match(html, /prefilled_email=a%40firma.cz/);
        assert.equal((await post(`${url}/confirm`, { t: ct })).status, 400);
        const mt = html.match(/name="t" value="([\w-]+)"/)[1];
        // free plan: editing to 7 keeps 5
        let m = await post(`${url}/manage`, { t: mt, icos: VALID.join(',') });
        assert.match(await m.text(), /Saved 5 suppliers.*2 over your plan limit/s);
        // Stripe checkout with client_reference_id -> starter
        const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, customer: 'cus_X', subscription: 'sub_X', metadata: { plan: 'starter' }, customer_details: { email: 'other@x.cz' } } } });
        assert.equal((await post(`${url}/stripe/webhook`, ev, { 'stripe-signature': 'bad' })).status, 400);
        assert.equal((await post(`${url}/stripe/webhook`, ev, { 'stripe-signature': sign(ev) })).status, 200);
        m = await post(`${url}/manage`, { t: mt, icos: VALID.join(',') }); assert.match(await m.text(), new RegExp(`Saved ${VALID.length} suppliers`));
        // subscription cancelled -> free again; run caps at 5
        const del = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_X', status: 'canceled' } } });
        await post(`${url}/stripe/webhook`, del, { 'stripe-signature': sign(del) });
        acc = new Accounts(path.join(dataDir, 'accounts.json')); assert.equal(acc.byEmail('a@firma.cz').plan, 'free');
        // magic link for a known email; unknown gets the same answer and no mail
        const n = sent.length;
        await post(`${url}/manage-link`, { email: 'nobody@x.cz' }); assert.equal(sent.length, n);
        await post(`${url}/manage-link`, { email: 'a@firma.cz' }); assert.equal(sent.length, n + 1);
        assert.equal((await fetch(`${url}/manage?t=${linkIn(sent[n], '/manage')}`)).status, 200);
        // unsubscribe: GET does nothing, POST does
        const ut = acc.byEmail('a@firma.cz').unsubToken;
        await fetch(`${url}/unsubscribe?t=${ut}`);
        assert.equal(new Accounts(path.join(dataDir, 'accounts.json')).byEmail('a@firma.cz').unsubscribed, false);
        assert.equal((await post(`${url}/unsubscribe?t=${ut}`, '')).status, 200);
        assert.equal(new Accounts(path.join(dataDir, 'accounts.json')).byEmail('a@firma.cz').unsubscribed, true);
    } finally { srv.close(); }
});

test('daily run: limit enforced, email only on change, never on first run', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swrun-'));
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    const { account, confirmToken } = acc.signup('b@x.cz', VALID, { consentText: 'x' }); acc.confirm(confirmToken);
    account.plan = 'starter'; acc.setIcos(account, VALID); account.plan = 'free'; acc.save(); // downgraded with 7 stored
    let unreliable = 'NE'; let seen;
    const check = async (items) => { seen = items.length; return { errors: {}, rows: items.map((i) => ({ ico: i.ico, label: null, expectedAccount: null, sourceErrors: [], ares: { name: 'X s.r.o.' }, vat: { unreliable, accounts: [], subjectType: 'PLATCE' }, isir: { cases: [] } })) }; };
    const sent = []; const mailer = { send: async (m) => sent.push(m) };
    await runAll({ dataDir, mailer, check, log: () => {} });
    assert.equal(seen, 5); assert.equal(sent.length, 0); // first run = baseline
    await runAll({ dataDir, mailer, check, log: () => {} }); assert.equal(sent.length, 0); // no change
    unreliable = 'ANO';
    await runAll({ dataDir, mailer, check, log: () => {} }); assert.equal(sent.length, 1);
    assert.match(sent[0].unsubscribeUrl, /\/unsubscribe\?t=/);
});

test('mailer dry-run writes outbox with unsubscribe link and header', async () => {
    const { createMailer } = await import('../src/mailer.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swmail-'));
    const m = createMailer({ DATA_DIR: dir });
    assert.equal(m.dry, true);
    await m.send({ to: 'c@x.cz', subject: 's', text: 'hi', unsubscribeUrl: 'https://sw.test/unsubscribe?t=abc' });
    const f = JSON.parse(fs.readFileSync(path.join(dir, 'outbox', fs.readdirSync(path.join(dir, 'outbox'))[0]), 'utf8'));
    assert.match(f.text, /Unsubscribe.*t=abc/); assert.equal(f.headers['List-Unsubscribe'], '<https://sw.test/unsubscribe?t=abc>');
});

test('daily run: a failed alert email is retried the next day, not lost', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swrun-'));
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    const { confirmToken } = acc.signup('m@x.cz', ['27082440'], { consentText: 'x' }); acc.confirm(confirmToken); acc.save();
    let unreliable = 'NE';
    const check = async (items) => ({ errors: {}, rows: items.map((i) => ({ ico: i.ico, sourceErrors: [], ares: { name: 'X' }, vat: { unreliable, accounts: [], subjectType: 'PLATCE_DPH' }, isir: { cases: [] } })) });
    let down = false; const sent = []; const mailer = { send: async (m) => { if (down) throw new Error('smtp down'); sent.push(m); } };
    await runAll({ dataDir, mailer, check, log: () => {} });
    unreliable = 'ANO'; down = true;
    const s = await runAll({ dataDir, mailer, check, log: () => {} }); assert.equal(s.failed, 1);
    down = false;
    await runAll({ dataDir, mailer, check, log: () => {} }); assert.equal(sent.length, 1);
    await runAll({ dataDir, mailer, check, log: () => {} }); assert.equal(sent.length, 1, 'sent once, then baseline updated');
});

test('daily run does not overwrite an unsubscribe or plan change made while it was running', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swrun-'));
    const file = path.join(dataDir, 'accounts.json');
    const acc = new Accounts(file);
    const { account, confirmToken } = acc.signup('r@x.cz', ['27082440'], { consentText: 'x' }); acc.confirm(confirmToken); acc.save();
    const check = async (items) => {
        const web = new Accounts(file); web.unsubscribe(account.unsubToken); web.get(account.id).plan = 'pro'; web.save(); // web app, mid-run
        return { errors: {}, rows: items.map((i) => ({ ico: i.ico, sourceErrors: [], ares: { name: 'X' }, isir: { cases: [] } })) };
    };
    // The run also writes (monthly report bookkeeping) to the same account: both changes must survive.
    const day = new Date('2026-10-01T05:00:00Z').getTime();
    fs.mkdirSync(path.join(dataDir, 'history', account.id), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'history', account.id, '2026-09.jsonl'), `${JSON.stringify({ at: '2026-09-10T05:00:00Z', list: 'main', ico: '27082440', checks: {} })}\n`);
    await runAll({ dataDir, mailer: { send: async () => {} }, check, log: () => {}, now: () => day });
    const after = new Accounts(file).get(account.id);
    assert.equal(after.unsubscribed, true); assert.equal(after.plan, 'pro'); assert.deepEqual(after.reportsSent, ['2026-09']);
});

test('accounts.json is imported into SQLite once and kept as .migrated', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swmig-'));
    const file = path.join(dataDir, 'accounts.json');
    fs.writeFileSync(file, JSON.stringify({ accounts: { acc_1: { id: 'acc_1', email: 'old@x.cz', plan: 'pro', icos: [], confirmed: true } }, tokens: { [crypto.createHash('sha256').update('tok').digest('hex')]: { accountId: 'acc_1', kind: 'manage', exp: Date.now() + 3600e3 } } }));
    const acc = new Accounts(file);
    assert.equal(acc.byEmail('old@x.cz').plan, 'pro'); assert.equal(acc.use('tok', 'manage').id, 'acc_1');
    assert.ok(!fs.existsSync(file)); assert.ok(fs.existsSync(`${file}.migrated`));
    assert.equal(new Accounts(file).all().length, 1);
});

test('daily run: an IČO on several lists is looked up once; a new supplier with a warning is emailed once', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swrun-'));
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    for (const e of ['p@x.cz', 'q@x.cz']) { const { confirmToken } = acc.signup(e, ['27082440'], { consentText: 'x' }); acc.confirm(confirmToken); }
    acc.save();
    const calls = { ares: 0, isir: 0 };
    const sources = {
        ares: async () => { calls.ares++; return { found: true, name: 'X a.s.', dic: 'CZ27082440' }; }, vr: async () => null,
        dph: async (dics) => ({ subjects: new Map(dics.map((d) => [d, { subjectType: 'PLATCE_DPH', unreliable: 'ANO', accounts: [] }])) }),
        isir: async () => { calls.isir++; return { cases: [] }; },
    };
    const sent = []; const mailer = { send: async (m) => sent.push(m) };
    await runAll({ dataDir, mailer, sources, canary: null, log: () => {} });
    assert.deepEqual(calls, { ares: 1, isir: 1 });
    assert.equal(sent.length, 2); assert.match(sent[0].subject, /warnings found/); assert.match(sent[0].text, /UNRELIABLE VAT PAYER/);
    await runAll({ dataDir, mailer, sources, canary: null, log: () => {} }); assert.equal(sent.length, 2, 'not repeated');
});

test('sign-up: link scanners cannot confirm, too many sign-ups per IP are refused, stale unconfirmed sign-ups are purged', async () => {
    const { dataDir, sent, srv } = setup(); const url = await listen(srv);
    try {
        for (let i = 0; i < 10; i++) assert.equal((await post(`${url}/signup`, { email: `s${i}@x.cz`, icos: '27082440', consent: 'yes' })).status, 200);
        assert.equal((await post(`${url}/signup`, { email: 's10@x.cz', icos: '27082440', consent: 'yes' })).status, 429);
        assert.equal((await post(`${url}/signup`, { email: 's11@x.cz', icos: '27082440', consent: 'yes' }, { 'x-forwarded-for': '8.8.8.8' })).status, 200);
        await fetch(`${url}/confirm?t=${linkIn(sent[0], '/confirm')}`);
        assert.equal(new Accounts(path.join(dataDir, 'accounts.json')).byEmail('s0@x.cz').confirmed, false);
    } finally { srv.close(); }
    const later = new Accounts(path.join(dataDir, 'accounts.json'), { now: () => Date.now() + 8 * 864e5 });
    assert.equal(later.purgeUnconfirmed(), 11); assert.equal(new Accounts(path.join(dataDir, 'accounts.json')).all().length, 0);
});

test('daily run: register data of a supplier removed from the list is deleted from the stored snapshot', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swrun-'));
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    const { account, confirmToken } = acc.signup('g@x.cz', ['27082440', '45274649'], { consentText: 'x' }); acc.confirm(confirmToken); acc.save();
    const check = async (items) => ({ errors: {}, rows: items.map((i) => ({ ico: i.ico, sourceErrors: [], ares: { found: true, name: 'Jan Novák', address: 'Praha' }, isir: { cases: [] } })) });
    await runAll({ dataDir, mailer: { send: async () => {} }, check, log: () => {} });
    const a = new Accounts(path.join(dataDir, 'accounts.json')); a.setIcos(a.get(account.id), ['27082440']); a.save();
    await runAll({ dataDir, mailer: { send: async () => {} }, check, log: () => {} });
    const st = JSON.parse(fs.readFileSync(path.join(dataDir, 'state', `${account.id}.json`), 'utf8'));
    assert.deepEqual(Object.keys(st.facts), ['27082440']); assert.deepEqual(Object.keys(st.latest), ['27082440']);
});
