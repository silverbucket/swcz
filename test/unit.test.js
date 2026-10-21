import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isValidIco, normaliseIco } from '../src/ico.js';
import { parseResponse as parseDph, normaliseAccount } from '../src/sources/dph.js';
import { parseResponse as parseIsir, envelope as isirEnvelope } from '../src/sources/isir.js';
import { checkWatchlist, facts, currentAlerts, changes } from '../src/check.js';

test('IČO checksum', () => {
    assert.equal(isValidIco('27082440'), true);
    assert.equal(isValidIco('6947'), true); // padded to 00006947
    assert.equal(normaliseIco('6947'), '00006947');
    assert.equal(isValidIco('12345678'), false);
});

test('account normalisation', () => {
    assert.equal(normaliseAccount('000035-3355550267 / 0100'), '35-3355550267/0100');
    assert.equal(normaliseAccount('cz40 2600 0000 0025 3192 0518'), 'CZ4026000000002531920518');
});

test('parses a real VAT register response', () => {
    const r = parseDph(fs.readFileSync('test/fixtures/dph-response.xml', 'utf8'));
    const alza = r.subjects.get('27082440');
    assert.equal(alza.unreliable, 'NE');
    assert.ok(alza.accounts.includes('2171532/0800'));
    assert.equal(r.subjects.get('09970207').unreliable, 'ANO');
});

test('ISIR: parses a case and drops personal fields', () => {
    const r = parseIsir(fs.readFileSync('test/fixtures/isir-response.xml', 'utf8'));
    assert.equal(r.cases.length, 1);
    assert.equal(r.cases[0].state, 'MORATORIUM');
    assert.equal(JSON.stringify(r).includes('1980-01-01'), false);
    assert.deepEqual(parseIsir(fs.readFileSync('test/fixtures/isir-none.xml', 'utf8')).cases, []);
    assert.match(isirEnvelope('9970207'), /<ic>9970207<\/ic>/);
});

test('changes: account removed, became unreliable; outage is not a change', () => {
    const prev = { name: 'A', unreliable: 'NE', accounts: ['1/0100', '2/0300'], vatSubjectType: 'PLATCE_DPH' };
    const cur = { name: 'A', unreliable: 'ANO', accounts: ['1/0100'], vatSubjectType: 'PLATCE_DPH' };
    const c = changes(prev, cur).map((x) => x.type).sort();
    assert.deepEqual(c, ['BANK_ACCOUNT_REMOVED', 'UNRELIABLE_STATUS_CHANGED']);
    assert.deepEqual(changes(prev, { name: 'A' }), []); // VAT source down today
});

test('end-to-end with stubbed sources', async () => {
    const sources = {
        ares: async (ico) => ({ found: true, ico, name: 'Demo s.r.o.', dic: `CZ${ico}`, aresInsolvencyFlag: 'NEEXISTUJICI' }),
        dph: async () => ({ generated: '2026-10-19', subjects: new Map([['27082440', { subjectType: 'PLATCE_DPH', unreliable: 'NE', accounts: ['9/0100'] }]]) }),
        isir: async () => { throw new Error('isir.justice.cz: ETIMEDOUT'); },
    };
    const { rows, errors } = await checkWatchlist([{ ico: '27082440', expectedAccount: '1/0100' }, { ico: '00006947' }], { sources });
    assert.equal(errors.isir, 1); // second call skipped after the timeout
    assert.deepEqual(currentAlerts(rows[0]), ['EXPECTED_ACCOUNT_NOT_PUBLISHED']);
    assert.equal(facts(rows[0]).isirCases, undefined);
});
