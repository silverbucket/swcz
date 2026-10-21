import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText, parseBytes, decodeBytes, looksLikeCsv, sniffDelimiter } from '../src/csv.js';
import { parseSupplierForm } from '../src/accounts.js';

// Encode a string as Windows-1250 (enough for Czech letters used here).
const CP = { 'Č': 0xC8, 'č': 0xE8, 'Ř': 0xD8, 'ř': 0xF8, 'Š': 0x8A, 'š': 0x9A, 'Ž': 0x8E, 'ž': 0x9E, 'á': 0xE1, 'é': 0xE9, 'í': 0xED, 'ý': 0xFD, 'ů': 0xF9, 'ú': 0xFA, 'ě': 0xEC, 'Í': 0xCD };
const cp1250 = (s) => Uint8Array.from([...s].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : CP[c] ?? 63)));
const utf8 = (s, bom = false) => new Uint8Array([...(bom ? [0xEF, 0xBB, 0xBF] : []), ...Buffer.from(s, 'utf8')]);

test('Pohoda address book export: CP1250, semicolons, IČ/Firma/Web, quoted values', () => {
    const csv = 'Číslo;Firma;Jméno;IČ;DIČ;Ulice;Obec;Web\r\n1;"Alza.cz a.s.";;27082440;CZ27082440;Jankovcova 1522/53;Praha;www.alza.cz\r\n2;"Dvořák; syn s.r.o.";Petr Dvořák;45274649;CZ45274649;Hlavní 1;Brno;https://www.cez.cz/cs\r\n3;Soukromá osoba;Jan Novák;;;;;\r\n';
    const r = parseBytes(cp1250(csv));
    assert.equal(r.encoding, 'Windows-1250'); assert.equal(r.format, 'Pohoda'); assert.equal(r.delimiter, ';');
    assert.deepEqual(r.rows.map((x) => [x.ico, x.web, x.name]), [['27082440', 'alza.cz', 'Alza.cz a.s.'], ['45274649', 'cez.cz', 'Dvořák; syn s.r.o.']]);
    assert.deepEqual(r.invalid, []);
});

test('Money S3 export: UTF-8 with BOM, IČO/Název/WWW, leading zeros lost by Excel, duplicates', () => {
    const csv = 'Kód partnera;Název;IČO;DIČ;WWW\n001;Ministerstvo financí;6947;;www.mfcr.cz\n002;Alza;27082440;CZ27082440;\n003;Alza duplicate;27 082 440;;\n004;Chybné;12345678;;\n';
    const r = parseBytes(utf8(csv, true));
    assert.equal(r.encoding, 'UTF-8 (BOM)'); assert.equal(r.format, 'Money S3');
    assert.deepEqual(r.rows.map((x) => [x.ico, x.web]), [['00006947', 'mfcr.cz'], ['27082440', '']]);
    assert.equal(r.duplicates, 1); assert.deepEqual(r.invalid.map((x) => [x.line, x.value, x.reason]), [[5, '12345678', 'invalid IČO']]);
});

test('Fakturoid contacts export: comma delimiter, registration_no / vat_no / web, quoted commas and newlines', () => {
    const csv = 'id,custom_id,type,name,full_name,email,registration_no,vat_no,web,street,city\n12,,supplier,"Firma, s.r.o.",,a@b.cz,27082440,CZ27082440,https://alza.cz,"Ulice 1\nPatro 2",Praha\n13,,customer,Foreign Ltd,,,,GB123,,x,London\n14,,supplier,Bad web,,,45274649,,not a website,,\n';
    const r = parseText(csv);
    assert.equal(r.format, 'Fakturoid'); assert.equal(r.delimiter, ',');
    assert.deepEqual(r.rows.map((x) => [x.ico, x.web, x.name]), [['27082440', 'alza.cz', 'Firma, s.r.o.'], ['45274649', '', 'Bad web']]);
    assert.equal(r.invalid.length, 1); assert.match(r.invalid[0].reason, /invalid website/);
});

test('generic CSV: header variants, tab delimiter, header-less files, UTF-16, errors', () => {
    assert.equal(parseText('ico,website\n27082440,alza.cz\n').format, 'generic');
    assert.deepEqual(parseText('IČ\tWeb\n27082440\talza.cz\n').rows.map((x) => x.web), ['alza.cz']);
    assert.equal(sniffDelimiter('a;b;c\n'), ';'); assert.equal(sniffDelimiter('"a;b",c,d'), ',');
    const hl = parseText('27082440;alza.cz\n45274649;\n');
    assert.deepEqual(hl.rows.map((x) => [x.ico, x.web]), [['27082440', 'alza.cz'], ['45274649', '']]);
    const u16 = new Uint8Array([0xFF, 0xFE, ...Buffer.from('IČO;Web\r\n27082440;alza.cz\r\n', 'utf16le')]);
    assert.equal(decodeBytes(u16).encoding, 'UTF-16LE'); assert.equal(parseBytes(u16).rows[0].ico, '27082440');
    assert.match(parseText('Name;City\nFoo;Bar\n').error, /No IČO column/);
    assert.match(parseText('').error, /empty/);
    assert.equal(parseText('IČO\nCZ27082440\n').invalid.length, 1, 'a DIČ in the IČO column is rejected');
    assert.deepEqual(parseText('IČO\n27082440.0\n').rows.map((x) => x.ico), ['27082440'], 'Excel numeric formatting');
});

test('server-side: a pasted CSV export in the paste box is parsed and validated with the same rules', () => {
    assert.equal(looksLikeCsv('IČ;Firma;Web\n27082440;Alza;alza.cz'), true);
    assert.equal(looksLikeCsv('27082440 alza.cz\n45274649'), false);
    const p = new URLSearchParams(); p.append('ico', '00006947'); p.append('web', '');
    p.set('icos', 'Firma;IČ;Web\nAlza;27082440;www.alza.cz\nBad;11111111;\nMF;6947;\n');
    const r = parseSupplierForm(p);
    assert.deepEqual(r.icos, ['00006947', '27082440']); assert.deepEqual(r.websites, { 27082440: 'alza.cz' }); assert.deepEqual(r.invalid, ['11111111']);
    // the old one-per-line paste still works
    const q = new URLSearchParams({ icos: '27082440 alza.cz\n45274649' });
    assert.deepEqual(parseSupplierForm(q).icos, ['27082440', '45274649']);
});

test('signup with a pasted CSV respects the free plan limit server-side', async () => {
    const { createServer } = await import('../src/server.js');
    const { tmp, listen, post, mailbox, accounts } = await import('./fixtures/helpers.js');
    const dataDir = tmp('swcsv-'); const srv = createServer({ dataDir, mailer: mailbox().mailer, log: () => {} }); const url = await listen(srv);
    try {
        const lines = ['IČO;Název'];
        const { icos } = await import('./fixtures/helpers.js'); for (const i of icos(8)) lines.push(`${i};Firma`);
        const r = await post(`${url}/signup`, { email: 'csv@x.cz', consent: 'yes', icos: lines.join('\n') });
        assert.equal(r.status, 200); assert.match(await r.text(), /first 5 were kept/);
        assert.equal(accounts(dataDir).byEmail('csv@x.cz').icos.length, 5);
    } finally { srv.close(); }
});

test('browser bundle: csvimport.js is served and the forms include the file input', async () => {
    const fs = await import('node:fs');
    const home = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
    assert.match(home, /class="sw-file"/); assert.match(home, /src="\/csvimport.js"/); assert.ok(home.indexOf('csvimport.js') < home.indexOf('suppliers.js'));
    const { supplierFields } = await import('../src/server.js'); assert.match(supplierFields([], {}, 50), /class="sw-file"/);
    assert.match(fs.readFileSync(new URL('../site/suppliers.js', import.meta.url), 'utf8'), /SWCsv\.parseBytes/);
});
