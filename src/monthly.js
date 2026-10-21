// Monthly PDF compliance report: every check run in a month, per supplier, with results and timestamps.
import fs from 'node:fs';
import path from 'node:path';
import { Pdf } from './pdf.js';
import { readHistory, prevMonth, pragueMonth } from './history.js';
import { PLAN_INFO } from './plans.js';
import { COI_CREDIT, COI_LICENCE_URL } from './sources/coi.js';

const COLS = [['ares', 'Business register (ARES)'], ['vat', 'Unreliable VAT payer'], ['accounts', 'Published bank accounts'], ['isir', 'Insolvency (ISIR)'], ['coi', 'ČOI risky websites']];
const STATUS = { ok: ['OK', [10, 124, 90]], alert: ['ALERT', [180, 40, 20]], failed: ['NOT CHECKED', [160, 90, 0]], not_run: ['-', [120, 128, 136]], invalid: ['invalid IČO', [180, 40, 20]] };
const prague = (iso) => new Date(iso).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export const monthLabel = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function summarise(records) {
    const runs = new Set(records.map((r) => r.at.slice(0, 16))).size;
    const suppliers = new Set(records.map((r) => `${r.list}|${r.ico}`)).size;
    let alerts = 0; let failed = 0;
    for (const r of records) for (const c of Object.values(r.checks ?? {})) { if (c.status === 'alert') alerts++; if (c.status === 'failed') failed++; }
    return { runs, suppliers, alerts, failed, checks: records.length };
}

/** Build the PDF. `records` are history records of one account for one month (optionally one client). */
export function buildMonthlyPdf({ account, month, records, generatedAt = new Date(), clientName = null }) {
    const pdf = new Pdf({ title: `Supplier Watch report ${month}` });
    const M = pdf.margin; const width = pdf.w - 2 * M;
    pdf.footer = `Supplier Watch · supplierwatch.cz · contact@supplierwatch.cz · ${account.email} · ${month}`;
    pdf.rect(0, pdf.h - 8, pdf.w, 8, [10, 124, 90]);
    pdf.para('Supplier Watch', { size: 11, bold: true, color: [10, 124, 90], gap: 2 });
    pdf.para(`Supplier check report: ${monthLabel(month)}`, { size: 20, bold: true, gap: 2 });
    pdf.para('Měsíční protokol o kontrole dodavatelů', { size: 11, color: [91, 104, 117], gap: 10 });
    const s = summarise(records);
    const meta = [['Account', account.email], ['Plan', PLAN_INFO[account.plan]?.name ?? account.plan], ...(clientName ? [['Client', clientName]] : []), ['Period', `${month}-01 to end of ${monthLabel(month)} (Prague time)`],
        ['Generated', `${prague(generatedAt.toISOString())} Prague time`], ['Suppliers checked', String(s.suppliers)], ['Daily check runs', String(s.runs)], ['Supplier checks recorded', String(s.checks)],
        ['Results with an alert', String(s.alerts)], ['Results not checked (source failed)', String(s.failed)]];
    for (const [k, v] of meta) pdf.row([{ text: k, width: 170, bold: true }, { text: v, width: width - 170 }], { size: 9.5 });
    pdf.y -= 10;
    pdf.para('What each column means', { size: 11, bold: true });
    pdf.para('ARES: the supplier is registered, not dissolved or in liquidation, and its name and registered address did not change. Unreliable VAT payer: whether the Financial Administration publishes the supplier as an unreliable VAT payer (§106a VAT Act). Published bank accounts: the accounts the supplier has published in the VAT register and any change to them (§109 VAT Act). ISIR: open insolvency proceedings in the Insolvency Register. ČOI: whether the supplier website you entered is on the Czech Trade Inspection list of risky e-shops (only if you gave a website).', { size: 8.5, color: [60, 70, 80] });
    pdf.para('OK = checked, nothing to report. ALERT = a warning or a change was found (details below the row). NOT CHECKED = the register did not answer or failed our daily self-check, so no result is claimed for that day. "-" = not applicable (e.g. no website given).', { size: 8.5, color: [60, 70, 80], gap: 10 });
    if (!records.length) pdf.para('No checks were recorded for this account in this month.', { size: 10, bold: true });

    const groups = new Map();
    for (const r of records) { const g = r.client ?? (r.list === 'main' ? null : r.list); const k = `${g ?? ''}`; if (!groups.has(k)) groups.set(k, new Map()); const sup = groups.get(k); if (!sup.has(r.ico)) sup.set(r.ico, []); sup.get(r.ico).push(r); }
    const colW = [86, ...COLS.map(() => (width - 86) / COLS.length)];
    const header = () => pdf.row([{ text: 'Checked (Prague)', width: colW[0], bold: true }, ...COLS.map(([, l], i) => ({ text: l, width: colW[i + 1], bold: true }))], { size: 7.5, bg: [238, 242, 245] });
    for (const [g, sup] of groups) {
        if (g) { pdf.ensure(40); pdf.y -= 6; pdf.para(`Client: ${g}`, { size: 13, bold: true }); }
        for (const [ico, rs] of sup) {
            rs.sort((a, b) => a.at.localeCompare(b.at));
            const last = rs[rs.length - 1];
            pdf.ensure(60); pdf.y -= 4;
            pdf.para(`${last.name ?? 'Unknown name'} · IČO ${ico}${last.website ? ` · ${last.website}` : ''}`, { size: 10.5, bold: true, gap: 2 });
            pdf.onPageBreak = header; header();
            for (const r of rs) {
                pdf.row([{ text: prague(r.at), width: colW[0] }, ...COLS.map(([k], i) => { const st = STATUS[r.checks?.[k]?.status] ?? ['?', [0, 0, 0]]; return { text: st[0], width: colW[i + 1], color: st[1], bold: st[0] !== 'OK' && st[0] !== '-' }; })], { size: 7.5 });
                const notes = COLS.filter(([k]) => ['alert', 'failed'].includes(r.checks?.[k]?.status)).map(([k, l]) => `${l}: ${r.checks[k].detail}`);
                for (const c of r.changes ?? []) notes.push(`Change ${c.type}${'from' in c ? `: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}` : `: ${JSON.stringify(c.to)}`}`);
                if (notes.length) pdf.row([{ text: '', width: colW[0] }, { text: notes.join(' · '), width: width - colW[0], color: [120, 50, 30] }], { size: 7 });
            }
            pdf.onPageBreak = null;
            pdf.para(`Latest result: ${COLS.map(([k, l]) => `${l} ${last.checks?.[k]?.detail ?? '-'}`).join('; ')}.`, { size: 7.5, color: [91, 104, 117], gap: 6 });
        }
    }
    pdf.ensure(120); pdf.y -= 8;
    pdf.para('Sources', { size: 11, bold: true });
    pdf.para('ARES, the administrative register of economic subjects (Ministry of Finance, ares.gov.cz). Registr plátců DPH, the VAT payer register (Financial Administration, mojedane.gov.cz / adisspr.mfcr.cz). ISIR, the insolvency register (Ministry of Justice, isir.justice.cz).', { size: 8.5 });
    pdf.para(`${COI_CREDIT}: seznam rizikových e-shopů, open data under the ČOI open-data licence (${COI_LICENCE_URL}). Supplier Watch is not affiliated with or endorsed by ČOI or any other authority.`, { size: 8.5 });
    pdf.para('This report records what the public registers returned when Supplier Watch checked them. It is information only, not an official extract and not legal or tax advice. Keep it with your records as evidence of the checks you ran; verify the official register before any payment decision.', { size: 8.5, color: [91, 104, 117] });
    pdf.para('Supplier Watch CZ, operated by Nicholas Kossow Jennings, sole trader, IČO 28948491, Maliřska 10, 170 00 Praha 7, Czech Republic. contact@supplierwatch.cz', { size: 8, color: [91, 104, 117] });
    return pdf.toBuffer();
}

export const reportPath = (dataDir, accountId, month, clientId = null) => path.join(dataDir, 'monthly', accountId.replace(/[^\w-]/g, ''), `${month}${clientId ? `-${clientId.replace(/[^\w-]/g, '')}` : ''}.pdf`);

/** Records for a month, optionally for one client list. */
export function monthRecords(dataDir, account, month, clientId = null) {
    const rs = readHistory(dataDir, account.id, month);
    return clientId ? rs.filter((r) => r.list === clientId) : rs;
}

/** Build (or rebuild for the current month) a report and return the PDF buffer. Past months are cached on disk. */
export function getReport(dataDir, account, month, { clientId = null, now = new Date() } = {}) {
    const f = reportPath(dataDir, account.id, month, clientId);
    const final = month < pragueMonth(now);
    if (final && fs.existsSync(f)) return fs.readFileSync(f);
    const client = clientId ? (account.clients ?? []).find((c) => c.id === clientId) : null;
    const buf = buildMonthlyPdf({ account, month, records: monthRecords(dataDir, account, month, clientId), generatedAt: now, clientName: client?.name ?? null });
    if (final) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf, { mode: 0o600 }); }
    return buf;
}

/**
 * On the first run of a month: email last month's report to each active account that has history for it
 * (and each client list's extra recipients get their client's report). Sent once per month per account.
 */
export async function sendMonthlyReports({ dataDir, acc, mailer, baseUrl, now = new Date(), log = () => {} }) {
    const month = prevMonth(pragueMonth(now)); let sent = 0;
    for (const a of acc.all()) {
        // Eligibility from the account as stored now (the daily run's copy can be hours old); bookkeeping stays on `a`.
        const cur = acc.fresh(a.id);
        if (!cur?.confirmed || cur.unsubscribed || cur.deleteAt || a.reportsSent?.includes(month)) continue;
        const recs = monthRecords(dataDir, a, month);
        if (!recs.length) continue;
        try {
            const buf = getReport(dataDir, cur, month, { now });
            await mailer.send({ to: cur.email, unsubscribeUrl: `${baseUrl}/unsubscribe?t=${cur.unsubToken}`, subject: `Supplier Watch: your ${monthLabel(month)} supplier check report / Měsíční protokol`,
                text: `Your monthly supplier check report for ${monthLabel(month)} is attached (PDF). It lists every check we ran, per supplier, with results and times. Keep it with your records as evidence that you checked your suppliers.\nV příloze je měsíční protokol o kontrolách dodavatelů za ${month}.\n\nYou can also download reports from your manage page: ${baseUrl}/#manage`,
                attachments: [{ filename: `supplierwatch-report-${month}.pdf`, content: buf, contentType: 'application/pdf' }] });
            sent++;
            // Re-read right before each recipient's email: an unsubscribe, a removed recipient or a deletion request made
            // during an earlier send stops it.
            const recipientOk = (c, r) => { const x = acc.fresh(a.id); return Boolean(x?.confirmed && !x.unsubscribed && !x.deleteAt && PLAN_INFO[x.plan]?.clients && x.clients?.find((y) => y.id === c.id)?.recipients?.some((y) => y.email === r.email && !y.unsubscribed)); };
            if (PLAN_INFO[cur.plan]?.clients) for (const c of cur.clients ?? []) for (const r of c.recipients ?? []) {
                if (!recs.some((x) => x.list === c.id) || !recipientOk(c, r)) continue;
                await mailer.send({ to: r.email, unsubscribeUrl: `${baseUrl}/unsubscribe?t=${r.unsubToken}`, subject: `Supplier Watch: ${c.name} supplier check report ${monthLabel(month)}`,
                    text: `${cur.email} set up Supplier Watch checks for ${c.name}. The ${monthLabel(month)} report is attached (PDF).`, attachments: [{ filename: `supplierwatch-report-${month}.pdf`, content: getReport(dataDir, cur, month, { clientId: c.id, now }), contentType: 'application/pdf' }] });
            }
            (a.reportsSent ??= []).push(month); a.reportsSent = a.reportsSent.slice(-24);
        } catch (e) { log(`monthly report ${a.id} failed: ${e.message}`); }
    }
    return sent;
}
