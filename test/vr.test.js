import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVr } from '../src/sources/ares.js';
import { checkWatchlist, facts, changes } from '../src/check.js';
import { buildReport } from '../src/report.js';

const vr = JSON.parse(fs.readFileSync(new URL('./fixtures/ares-vr-27082440.json', import.meta.url), 'utf8'));

test('ARES public register: fingerprints of current statutory body and owners, no names stored', () => {
    const r = parseVr(vr);
    assert.match(r.statutoryHash, /^[0-9a-f]{16}$/); assert.ok(r.statutoryCount > 0); assert.match(r.ownersHash, /^([0-9a-f]{16}|none)$/);
    assert.doesNotMatch(JSON.stringify(r), /[A-ZÁ-Ž][a-zá-ž]+ [A-ZÁ-Ž][a-zá-ž]+/, 'no personal names in the result');
    // removing a current board member changes the fingerprint; changing an already-deleted (historical) one does not
    const z = structuredClone(vr); const rec = z.zaznamy.find((x) => x.primarniZaznam);
    const org = rec.statutarniOrgany[0]; const cur = org.clenoveOrganu.findIndex((m) => !m.datumVymazu); const old = org.clenoveOrganu.findIndex((m) => m.datumVymazu);
    const z2 = structuredClone(z); z2.zaznamy.find((x) => x.primarniZaznam).statutarniOrgany[0].clenoveOrganu[old].fyzickaOsoba = { jmeno: 'X', prijmeni: 'Y' };
    assert.equal(parseVr(z2).statutoryHash, r.statutoryHash);
    org.clenoveOrganu[cur].datumVymazu = '2026-10-20';
    assert.notEqual(parseVr(z).statutoryHash, r.statutoryHash);
    assert.throws(() => parseVr({ zaznamy: [] }), /no record/);
});

test('a statutory-body change is reported (with a link to the public register) only when both days have data', async () => {
    let hash = 'aaaa';
    const sources = { ares: async (ico) => ({ found: true, ico, name: 'X a.s.', aresPublicRegisterFlag: 'AKTIVNI' }), vr: async () => ({ statutoryHash: hash, ownersHash: 'o1' }), dph: async () => ({ subjects: new Map() }), isir: async () => ({ cases: [] }) };
    const d1 = (await checkWatchlist([{ ico: '27082440' }], { sources })).rows[0]; hash = 'bbbb';
    const d2 = (await checkWatchlist([{ ico: '27082440' }], { sources })).rows[0];
    const ch = changes(facts(d1), facts(d2)); assert.deepEqual(ch.map((c) => c.type), ['STATUTORY_BODY_CHANGED']);
    const txt = buildReport({ items: [{ ico: '27082440', name: 'X a.s.', alerts: [], changes: ch, sourceErrors: [] }], errors: {} });
    assert.match(txt, /Statutory body .* changed/); assert.match(txt, /or\.justice\.cz\/ias\/ui\/rejstrik-\$firma\?ico=27082440/); assert.doesNotMatch(txt, /aaaa|bbbb/);
    // VR down today: no field, no change
    sources.vr = async () => { throw new Error('down'); };
    const d3 = (await checkWatchlist([{ ico: '27082440' }], { sources })).rows[0];
    assert.deepEqual(changes(facts(d2), facts(d3)), []); assert.ok(d3.sourceErrors.some((e) => e.startsWith('vr:')));
    // sole traders (not in the public register) are not queried
    let called = false; sources.vr = async () => { called = true; }; sources.ares = async (ico) => ({ found: true, ico, aresPublicRegisterFlag: 'NEEXISTUJICI' });
    await checkWatchlist([{ ico: '27082440' }], { sources }); assert.equal(called, false);
});
