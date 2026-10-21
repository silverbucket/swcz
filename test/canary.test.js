import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROBES, runCanary, readStatus, skipFrom, CANARY_ICO } from '../src/canary.js';
import { runAll } from '../src/run.js';
import { createServer } from '../src/server.js';
import { readHistory } from '../src/history.js';
import { tmp, icos, fakeWorld, mailbox, listen, makeAccount } from './fixtures/helpers.js';

const good = {
    ares: async (ico) => ({ found: true, ico, name: 'Alza.cz a.s.', address: 'Jankovcova 1522/53, Praha 7', aresInsolvencyFlag: 'NEEXISTUJICI' }),
    dph: async () => ({ subjects: new Map([[CANARY_ICO, { subjectType: 'PLATCE_DPH', unreliable: 'NE', accounts: ['2727/2700', 'CZ6508000000192000145399'] }]]) }),
    isir: async () => ({ cases: [] }),
    coi: async () => Array.from({ length: 80 }, (_, i) => ({ domain: `shop${i}.cz` })),
};

test('probes accept the expected structure and reject changed or empty answers', async () => {
    for (const k of Object.keys(PROBES)) await PROBES[k](good);
    const bad = {
        ares: [async () => ({ found: false }), async () => ({ found: true, ico: CANARY_ICO, name: 'x', address: null, aresInsolvencyFlag: 'X' }), async () => ({ found: true, ico: CANARY_ICO, obchodniJmeno: 'renamed field' })],
        vat: [async () => ({ subjects: new Map() }), async () => ({ subjects: new Map([[CANARY_ICO, { subjectType: 'NEW_TYPE', unreliable: 'NE', accounts: ['1/0100'] }]]) }), async () => ({ subjects: new Map([[CANARY_ICO, { subjectType: 'PLATCE_DPH', unreliable: 'NE', accounts: [] }]]) })],
        isir: [async () => ({}), async () => ({ cases: [{ caseNo: 5 }] })],
        coi: [async () => [], async () => Array.from({ length: 80 }, () => ({ domain: 'garbage' }))],
    };
    const dep = { ares: 'ares', vat: 'dph', isir: 'isir', coi: 'coi' };
    for (const [k, fns] of Object.entries(bad)) for (const fn of fns) await assert.rejects(PROBES[k]({ ...good, [dep[k]]: fn }), /unexpected structure/, k);
});

test('runCanary: writes status, emails OPS_EMAIL on failure and on recovery, skips disabled sources', async () => {
    const dataDir = tmp('swcan-'); const { sent, mailer } = mailbox();
    let st = await runCanary({ env: { OPS_EMAIL: 'ops@x.cz' }, dataDir, deps: good, mailer });
    assert.equal(st.ok, true); assert.equal(sent.length, 0); assert.deepEqual(readStatus(dataDir).failed, []);
    st = await runCanary({ env: { OPS_EMAIL: 'ops@x.cz' }, dataDir, deps: { ...good, isir: async () => { throw new Error('isir.justice.cz: ETIMEDOUT'); } }, mailer });
    assert.equal(st.ok, false); assert.deepEqual(st.failed, ['isir']); assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ops@x.cz'); assert.match(sent[0].subject, /FAILED \(isir\)/); assert.match(sent[0].text, /ETIMEDOUT/);
    assert.deepEqual(skipFrom(st), { isir: true });
    st = await runCanary({ env: {}, dataDir, deps: good, mailer }); assert.equal(sent.length, 2); assert.equal(sent[1].to, 'contact@supplierwatch.cz', 'default ops address'); assert.match(sent[1].subject, /OK again/);
    st = await runCanary({ env: { ISIR_DISABLED: '1', COI_DISABLED: '1' }, dataDir, deps: { ...good, isir: async () => { throw new Error('x'); } }, mailer });
    assert.equal(st.ok, true); assert.equal(st.sources.isir.disabled, true);
    assert.deepEqual(skipFrom({ failed: ['vat', 'ares'] }), { dph: true, ares: true });
    st = await runCanary({ env: {}, dataDir, deps: good, timeoutMs: 20, probes: { ...PROBES, ares: () => new Promise(() => {}) } });
    assert.match(st.sources.ares.error, /timeout/);
});

test('a source that fails the self-check is marked NOT CHECKED for customers: no false all-clear, no inferred change', async () => {
    const dataDir = tmp('swcan2-'); const S = icos(2);
    const a = makeAccount(dataDir, 'c@x.cz', { plan: 'starter', icos: S });
    const { world, check } = fakeWorld(); const { sent, mailer } = mailbox();
    let t = Date.parse('2026-10-19T04:30:00Z'); const now = () => t;
    const canaryOk = async () => ({ ok: true, failed: [] });
    await runAll({ dataDir, mailer, check, canary: canaryOk, log: () => {}, now });
    // day 2: the VAT register answers but the canary says its structure changed; the supplier "looks" reliable
    // and a different account list comes back - none of that may be reported as fact
    t = Date.parse('2026-10-20T04:30:00Z'); world.accounts[`${S[0]}`] = ['555/0800'];
    const canaryVatBad = async ({ dataDir: d }) => { fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({ checkedAt: new Date(t).toISOString(), ok: false, failed: ['vat'], sources: { vat: { ok: false, error: 'unexpected structure' } } })); return { ok: false, failed: ['vat'] }; };
    const s = await runAll({ dataDir, mailer, check, canary: canaryVatBad, log: () => {}, now });
    assert.deepEqual(s.sourcesFailed, ['vat']);
    assert.equal(sent.length, 0, 'no change inferred from a failed source');
    const rec = readHistory(dataDir, a.id, '2026-10').filter((r) => r.at.startsWith('2026-10-20'));
    assert.equal(rec.length, 2); assert.ok(rec.every((r) => r.checks.vat.status === 'failed' && r.checks.accounts.status === 'failed'));
    assert.ok(rec.every((r) => r.checks.ares.status === 'ok'), 'other sources still checked');
    const txt = fs.readFileSync(path.join(dataDir, 'reports', `${a.id}-${new Date().toISOString().slice(0, 10)}.txt`), 'utf8');
    assert.match(txt, /NOT CHECKED today \(source failed\): VAT register/); assert.match(txt, /This is NOT an all-clear/);
    assert.doesNotMatch(txt, /^No alerts or changes\. \/ Žádná/m);
    // day 3: VAT ok again -> the real account change is now reported
    t = Date.parse('2026-10-21T04:30:00Z');
    await runAll({ dataDir, mailer, check, canary: canaryOk, log: () => {}, now });
    assert.equal(sent.length, 1); assert.match(sent[0].text, /555\/0800/);
});

test('/healthz stays minimal; /healthz?detail=1 shows version and the self-check status', async () => {
    const dataDir = tmp('swcan3-'); const srv = createServer({ dataDir, mailer: mailbox().mailer, log: () => {} }); const url = await listen(srv);
    try {
        assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { ok: true });
        let j = await (await fetch(`${url}/healthz?detail=1`)).json(); assert.equal(j.sources, null); assert.equal(j.version, '0.7.0');
        await runCanary({ env: {}, dataDir, deps: { ...good, coi: async () => [] } });
        j = await (await fetch(`${url}/healthz?detail=1`)).json(); assert.equal(j.sources.ok, false); assert.deepEqual(j.sources.failed, ['coi']); assert.equal(j.sources.detail.ares.ok, true);
    } finally { srv.close(); }
});
