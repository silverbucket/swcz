import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, supplierFields } from '../src/server.js';
import { Accounts, parseSupplierForm } from '../src/accounts.js';

const rows = (pairs, extra = {}) => { const p = new URLSearchParams(extra); for (const [i, w] of pairs) { p.append('ico', i); p.append('web', w); } return p; };

test('structured rows: IČO checksum, website normalised, duplicates and blanks ignored', () => {
    const r = parseSupplierForm(rows([['27082440', 'https://www.Firma.cz/kontakt?x=1'], ['6947', ''], ['', ''], ['12345678', 'x.cz'], ['27082440', ''], ['45274649', 'not a domain']]));
    assert.deepEqual(r.icos, ['27082440', '00006947', '45274649']);
    assert.deepEqual(r.websites, { 27082440: 'firma.cz' });
    assert.deepEqual(r.invalid, ['12345678', 'not a domain']);
    assert.deepEqual(parseSupplierForm(rows([['2708244a', '']])).icos, []);
});

test('old textarea format still accepted and merged with rows', () => {
    const r = parseSupplierForm(rows([['27082440', '']], { icos: '45274649 http://shop.cz/\n27082440 firma.cz' }));
    assert.deepEqual(r.icos, ['27082440', '45274649']);
    assert.deepEqual(r.websites, { 45274649: 'shop.cz', 27082440: 'firma.cz' });
    assert.deepEqual(parseSupplierForm('icos=27082440+firma.cz').websites, { 27082440: 'firma.cz' });
});

test('supplierFields renders rows, limit and paste box; client script is valid JS', () => {
    const h = supplierFields(['27082440'], { 27082440: 'firma.cz' }, 50);
    assert.match(h, /data-limit="50"/); assert.match(h, /name="ico"[^>]*value="27082440"/); assert.match(h, /value="firma.cz"/);
    assert.match(h, /<details class="sw-paste">/); assert.match(h, /name="icos"/);
    execFileSync(process.execPath, ['--check', new URL('../site/suppliers.js', import.meta.url).pathname]);
});

test('signup via rows; site serves rows, fax trap and script', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swform-')); const sent = [];
    const srv = createServer({ dataDir, secret: 'x', baseUrl: 'https://sw.test', mailer: { send: async (m) => { sent.push(m); } }, log: () => {} });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}`;
    try {
        const home = await (await fetch(`${url}/`)).text();
        assert.match(home, /class="sw-sup" data-limit="5"/); assert.match(home, /name="fax"/); assert.match(home, /src="\/?suppliers.js"/);
        assert.doesNotMatch(home, /<textarea[^>]*required/);
        const js = await fetch(`${url}/suppliers.js`); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
        const body = rows([['27082440', 'www.firma.cz'], ['6947', '']], { email: 'r@firma.cz', consent: 'yes' });
        assert.equal((await fetch(`${url}/signup`, { method: 'POST', body })).status, 200);
        const a = new Accounts(path.join(dataDir, 'accounts.json')).byEmail('r@firma.cz');
        assert.deepEqual(a.icos, ['27082440', '00006947']); assert.deepEqual(a.websites, { 27082440: 'firma.cz' });
        const trap = rows([['27082440', '']], { email: 't@firma.cz', consent: 'yes', fax: 'spam' });
        await fetch(`${url}/signup`, { method: 'POST', body: trap });
        assert.equal(new Accounts(path.join(dataDir, 'accounts.json')).byEmail('t@firma.cz'), null);
        assert.equal(sent.length, 1);
    } finally { srv.close(); }
});
