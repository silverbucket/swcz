// Live tests against the official sources. Run: LIVE=1 npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSubject } from '../src/sources/ares.js';
import { getStatuses } from '../src/sources/dph.js';
import { getByIco } from '../src/sources/isir.js';

const live = process.env.LIVE === '1';

test('live ARES', { skip: !live }, async () => {
    const s = await getSubject('27082440');
    assert.equal(s.found, true);
    assert.match(s.name, /Alza/i);
    assert.equal((await getSubject('00000019')).found, false);
});

test('live VAT register', { skip: !live }, async () => {
    const r = await getStatuses(['27082440', '00006947']);
    assert.equal(r.subjects.get('27082440').unreliable, 'NE');
    assert.ok(r.subjects.get('00006947').accounts.length > 0);
});

test('live ISIR (needs outbound port 8443)', { skip: !live || process.env.ISIR !== '1' }, async () => {
    const r = await getByIco('27082440');
    assert.ok(Array.isArray(r.cases));
});

test('LIVE: data-source self-check against the real registers (LIVE=1; ISIR needs port 8443)', { skip: process.env.LIVE !== '1' }, async () => {
    const { runCanary } = await import('../src/canary.js');
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const st = await runCanary({ env: { ISIR_DISABLED: process.env.ISIR === '1' ? '0' : '1' }, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'swlive-')) });
    assert.deepEqual(st.failed, [], JSON.stringify(st.sources));
});
