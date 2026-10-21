import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { runAll } from '../src/run.js';
import { createServer } from '../src/server.js';
import { buildMonthlyPdf, summarise } from '../src/monthly.js';
import { PDF_CHARS } from '../src/pdf.js';
import { recordFor, readHistory, pruneHistory, pragueMonth, historyMonths } from '../src/history.js';
import { tmp, icos, fakeWorld, mailbox, listen, makeAccount, accounts } from './fixtures/helpers.js';

/** Text drawn in a PDF made by src/pdf.js (inflates the content streams, decodes octal escapes). */
function pdfText(buf) {
    const s = buf.toString('latin1'); let out = '';
    for (const m of s.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
        const ops = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
        for (const t of ops.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) out += t[1].replace(/\\([0-7]{3}|.)/g, (x, c) => (c.length === 3 ? (parseInt(c, 8) >= 128 ? PDF_CHARS[parseInt(c, 8) - 128] : String.fromCharCode(parseInt(c, 8))) : c)) + '\n';
    }
    return out;
}
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('history record: explicit status per check, failed source is never OK', () => {
    const base = { ico: '27082440', name: 'Alza', address: 'Praha', alerts: [], changes: [], vatSubjectType: 'PLATCE_DPH', publishedAccounts: ['1/0100'], insolvencyCases: [], website: null, sourceErrors: [] };
    let r = recordFor(base, { coiRun: false });
    assert.deepEqual(Object.fromEntries(Object.entries(r.checks).map(([k, v]) => [k, v.status])), { ares: 'ok', vat: 'ok', accounts: 'ok', isir: 'ok', coi: 'not_run' });
    r = recordFor({ ...base, insolvencyCases: null, sourceErrors: ['isir: ETIMEDOUT', 'dph: failed daily self-check'] });
    assert.equal(r.checks.isir.status, 'failed'); assert.equal(r.checks.vat.status, 'failed'); assert.equal(r.checks.accounts.status, 'failed');
    r = recordFor({ ...base, alerts: ['UNRELIABLE_VAT_PAYER', 'INSOLVENCY_PROCEEDING'], insolvencyCases: [{ caseNo: 'INS 5/2026' }], website: 'x.cz', changes: [{ type: 'STATUTORY_BODY_CHANGED' }] }, { coiRun: true });
    assert.equal(r.checks.vat.status, 'alert'); assert.equal(r.checks.isir.status, 'alert'); assert.equal(r.checks.ares.status, 'alert'); assert.equal(r.checks.coi.status, 'ok');
    assert.equal(recordFor({ ...base, alerts: ['INVALID_ICO'] }).checks.vat.status, 'invalid');
});

test('daily runs write history; monthly PDF lists every run per supplier with results, times and sources', async () => {
    const dataDir = tmp('swpdf-'); const S = icos(3);
    const a = makeAccount(dataDir, 'pdf@x.cz', { plan: 'starter', icos: S, websites: { [S[0]]: 'risky-shop.cz' } });
    const { world, check } = fakeWorld(); const { sent, mailer } = mailbox();
    const loadCoi = async () => ({ entries: [{ domain: 'risky-shop.cz', reason: 'nedodání zboží', listedOn: '2026-09-01' }] });
    let t = Date.parse('2026-09-28T04:30:00Z'); const now = () => t;
    for (const day of ['2026-09-28', '2026-09-29', '2026-09-30']) {
        t = Date.parse(`${day}T04:30:00Z`);
        if (day === '2026-09-29') world.down.isir = true; else delete world.down.isir;
        if (day === '2026-09-30') world.unreliable[S[1]] = 'ANO';
        await runAll({ dataDir, mailer, check, log: () => {}, now, loadCoi });
    }
    const recs = readHistory(dataDir, a.id, '2026-09');
    assert.equal(recs.length, 9);
    assert.ok(recs.filter((r) => r.at.startsWith('2026-09-29')).every((r) => r.checks.isir.status === 'failed'));
    assert.equal(recs.find((r) => r.ico === S[0]).checks.coi.status, 'alert');
    assert.deepEqual(summarise(recs), { runs: 3, suppliers: 3, alerts: 4, failed: 3, checks: 9 });
    assert.deepEqual(historyMonths(dataDir, a.id), ['2026-09']);
    // the alert email on the day ISIR failed says so explicitly, never a bare all-clear
    const pdf = buildMonthlyPdf({ account: accounts(dataDir).get(a.id), month: '2026-09', records: recs, generatedAt: new Date('2026-10-01T05:00:00Z') });
    assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4'); assert.match(pdf.subarray(-6).toString(), /%%EOF/);
    const txt = pdfText(pdf);
    for (const s of S) assert.ok(txt.includes(`IČO ${s}`), s);
    assert.match(txt, /September 2026/); assert.match(txt, /pdf@x\.cz/);
    assert.match(txt, /28\. ?0?9\. ?2026/); assert.match(txt, /NOT CHECKED/); assert.match(txt, /ALERT/);
    assert.match(txt, /unreliable VAT payer/); assert.match(txt, /Zdroj: Česká obchodní inspekce/); assert.match(txt, /ARES/); assert.match(txt, /ISIR/);
    assert.match(txt, /IČO 28948491/);
    if (hasPdftotext) { const f = path.join(dataDir, 'r.pdf'); fs.writeFileSync(f, pdf); const out = execFileSync('pdftotext', [f, '-']).toString(); assert.match(out, /Česká obchodní inspekce/); assert.match(out, /Supplier check report: September 2026/); }

    // 1 October: the run emails September's report as a PDF attachment, once
    sent.length = 0; t = Date.parse('2026-10-01T04:30:00Z');
    let s = await runAll({ dataDir, mailer, check, log: () => {}, now, loadCoi });
    assert.equal(s.reports, 1);
    const m = sent.find((x) => /report/.test(x.subject)); assert.ok(m); assert.equal(m.to, 'pdf@x.cz');
    assert.equal(m.attachments[0].contentType, 'application/pdf'); assert.equal(m.attachments[0].filename, 'supplierwatch-report-2026-09.pdf');
    assert.match(pdfText(m.attachments[0].content), /IČO/);
    assert.ok(fs.existsSync(path.join(dataDir, 'monthly', a.id, '2026-09.pdf')));
    t = Date.parse('2026-10-02T04:30:00Z'); s = await runAll({ dataDir, mailer, check, log: () => {}, now, loadCoi }); assert.equal(s.reports, 0);

    // download from the manage page (past month cached; current month built on demand)
    const srv = createServer({ dataDir, mailer, log: () => {}, now }); const url = await listen(srv);
    try {
        const acc = accounts(dataDir); const tok = acc.issue(a.id, 'manage'); acc.save();
        const html = await (await fetch(`${url}/manage?t=${tok}`)).text(); assert.match(html, /September 2026 \(PDF\)/); assert.match(html, /October 2026 \(PDF\)/);
        let r = await fetch(`${url}/manage?t=${tok}&report=2026-09`); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf'); assert.match(r.headers.get('content-disposition'), /supplierwatch-report-2026-09\.pdf/);
        assert.match((await r.arrayBuffer()).byteLength.toString(), /\d{4,}/);
        r = await fetch(`${url}/manage?t=${tok}&report=2026-10`); assert.equal(r.status, 200); assert.match(pdfText(Buffer.from(await r.arrayBuffer())), /October 2026/);
        assert.equal((await fetch(`${url}/manage?t=${tok}&report=../../etc`)).status, 400);
        assert.equal((await fetch(`${url}/manage?t=bad&report=2026-09`)).status, 400);
        // another account's token cannot fetch this account's report
        const b = makeAccount(dataDir, 'other@x.cz', { icos: [S[0]] }); const acc2 = accounts(dataDir); const tb = acc2.issue(b.id, 'manage'); acc2.save();
        assert.doesNotMatch(pdfText(Buffer.from(await (await fetch(`${url}/manage?t=${tb}&report=2026-09`)).arrayBuffer())), /pdf@x\.cz/);
    } finally { srv.close(); }
});

test('history retention: files older than HISTORY_MONTHS full months are deleted', () => {
    const dataDir = tmp('swret-'); const d = path.join(dataDir, 'history', 'acc_1'); const m = path.join(dataDir, 'monthly', 'acc_1');
    fs.mkdirSync(d, { recursive: true }); fs.mkdirSync(m, { recursive: true });
    for (const x of ['2024-09', '2024-10', '2025-06', '2026-10']) fs.writeFileSync(path.join(d, `${x}.jsonl`), '{}\n');
    fs.writeFileSync(path.join(m, '2024-09.pdf'), 'x'); fs.writeFileSync(path.join(m, '2024-10-cl_1.pdf'), 'x');
    const n = pruneHistory(dataDir, 24, new Date('2026-10-21T10:00:00Z'));
    assert.equal(n, 2); assert.deepEqual(fs.readdirSync(d).sort(), ['2024-10.jsonl', '2025-06.jsonl', '2026-10.jsonl']); assert.deepEqual(fs.readdirSync(m), ['2024-10-cl_1.pdf']);
    assert.equal(pragueMonth(new Date('2026-09-30T22:30:00Z')), '2026-10', 'months are in Prague time');
});

test('mailer: attachments are passed through and stored in the dry-run outbox', async () => {
    const { createMailer } = await import('../src/mailer.js');
    const dir = tmp('swmailatt-'); const m = createMailer({ DATA_DIR: dir });
    await m.send({ to: 'a@x.cz', subject: 's', text: 't', unsubscribeUrl: 'https://sw.test/u', attachments: [{ filename: 'r.pdf', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' }] });
    const files = fs.readdirSync(path.join(dir, 'outbox')); const j = JSON.parse(fs.readFileSync(path.join(dir, 'outbox', files.find((f) => f.endsWith('.json'))), 'utf8'));
    assert.equal(j.attachments[0].filename, 'r.pdf'); assert.equal(fs.readFileSync(path.join(dir, 'outbox', j.attachments[0].file), 'utf8'), '%PDF-1.4');
});
