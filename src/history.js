// Check history: one JSON line per supplier per daily check, in DATA_DIR/history/<account>/<YYYY-MM>.jsonl
// (month in Prague time). Used for the monthly PDF compliance report and the API.
// Retention: HISTORY_MONTHS (default 24) full months after the month of the check, then deleted by pruneHistory().
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_HISTORY_MONTHS = 24;
export const SOURCES = ['ares', 'vat', 'accounts', 'isir', 'coi'];

/** "YYYY-MM" of a date in Europe/Prague. */
export function pragueMonth(d = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}`;
}
export function pragueDay(d = new Date()) { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', day: 'numeric' }).format(d)); }
export function prevMonth(ym) { let [y, m] = ym.split('-').map(Number); m -= 1; if (!m) { m = 12; y -= 1; } return `${y}-${String(m).padStart(2, '0')}`; }
export const validMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s ?? ''));

const hasErr = (item, src) => item.sourceErrors?.some((e) => e.startsWith(`${src}:`));

/** Turn one runner report item into a history record with an explicit status per check. */
export function recordFor(item, { at = new Date().toISOString(), list = 'main', client = null, isirEnabled = true, coiRun = false } = {}) {
    const ch = (item.changes ?? []).map((c) => c.type); const al = item.alerts ?? [];
    const rec = { at, list, client, ico: item.ico, name: item.name ?? null, website: item.website ?? null, alerts: al, changes: item.changes ?? [], checks: {} };
    if (al.includes('INVALID_ICO')) { for (const s of SOURCES) rec.checks[s] = { status: 'invalid', detail: 'invalid IČO' }; return rec; }
    const c = rec.checks;
    if (hasErr(item, 'ares')) c.ares = { status: 'failed', detail: 'ARES did not answer or failed the daily self-check' };
    else if (al.some((x) => ['NOT_IN_ARES', 'DISSOLVED', 'IN_LIQUIDATION'].includes(x)) || ch.some((x) => ['NAME_CHANGED', 'ADDRESS_CHANGED', 'DISSOLVED_CHANGED', 'ARES_PRESENCE_CHANGED', 'STATUTORY_BODY_CHANGED', 'OWNERS_CHANGED'].includes(x))) c.ares = { status: 'alert', detail: [...al.filter((x) => ['NOT_IN_ARES', 'DISSOLVED', 'IN_LIQUIDATION'].includes(x)), ...ch.filter((x) => /NAME|ADDRESS|DISSOLVED|PRESENCE|STATUTORY|OWNERS/.test(x))].join(', ') };
    else c.ares = { status: 'ok', detail: `${item.address ? `registered: ${item.address}` : 'registered'}${hasErr(item, 'vr') ? ' (directors/owners not checked today: public register did not answer)' : ''}` };
    if (hasErr(item, 'dph')) { c.vat = { status: 'failed', detail: 'VAT register did not answer or failed the daily self-check' }; c.accounts = { ...c.vat }; }
    else {
        c.vat = al.includes('UNRELIABLE_VAT_PAYER') ? { status: 'alert', detail: `unreliable VAT payer${item.unreliableSince ? ` since ${item.unreliableSince}` : ''}` }
            : { status: 'ok', detail: item.vatSubjectType === 'NENALEZEN' || !item.vatSubjectType ? 'not in the VAT register' : `not unreliable (${item.vatSubjectType})` };
        const n = item.publishedAccounts?.length ?? 0;
        c.accounts = al.includes('EXPECTED_ACCOUNT_NOT_PUBLISHED') || ch.some((x) => x.startsWith('BANK_ACCOUNT_') || x === 'EXPECTED_ACCOUNT_STATUS_CHANGED')
            ? { status: 'alert', detail: `published accounts changed (${n} published)` } : { status: 'ok', detail: `${n} published account${n === 1 ? '' : 's'}` };
    }
    if (hasErr(item, 'isir')) c.isir = { status: 'failed', detail: 'ISIR did not answer or failed the daily self-check' };
    else if (!isirEnabled || item.insolvencyCases == null) c.isir = { status: 'not_run', detail: 'not checked' };
    else c.isir = al.includes('INSOLVENCY_PROCEEDING') || ch.includes('INSOLVENCY_CASE_NEW_OR_CHANGED') ? { status: 'alert', detail: item.insolvencyCases.map((x) => x.caseNo).join(', ') } : { status: 'ok', detail: item.insolvencyCases.length ? 'only ended proceedings' : 'no proceedings' };
    if (!item.website) c.coi = { status: 'not_run', detail: 'no website given' };
    else if (hasErr(item, 'coi') || !coiRun) c.coi = { status: coiRun ? 'failed' : 'not_run', detail: coiRun ? 'ČOI list unavailable' : 'not checked' };
    else c.coi = al.includes('COI_RISKY_WEBSITE') || ch.some((x) => x.startsWith('COI_')) ? { status: 'alert', detail: `${item.website} on the ČOI list` } : { status: 'ok', detail: `${item.website} not listed` };
    return rec;
}

const dirFor = (dataDir, accountId) => path.join(dataDir, 'history', accountId.replace(/[^\w-]/g, ''));
export function appendHistory(dataDir, accountId, records, at = new Date()) {
    if (!records.length) return;
    const d = dirFor(dataDir, accountId); fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, `${pragueMonth(at)}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
}
export function readHistory(dataDir, accountId, month) {
    const f = path.join(dirFor(dataDir, accountId), `${month}.jsonl`);
    if (!validMonth(month) || !fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export function historyMonths(dataDir, accountId) {
    const d = dirFor(dataDir, accountId); if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).map((f) => f.match(/^(\d{4}-\d{2})\.jsonl$/)?.[1]).filter(Boolean).sort().reverse();
}
/** Delete history (and stored PDF reports) older than `months` full months. Returns files removed. */
export function pruneHistory(dataDir, months = DEFAULT_HISTORY_MONTHS, now = new Date()) {
    let cut = pragueMonth(now); for (let i = 0; i < months; i++) cut = prevMonth(cut);
    let n = 0;
    for (const sub of ['history', 'monthly']) {
        const root = path.join(dataDir, sub); if (!fs.existsSync(root)) continue;
        for (const acc of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root, acc))) {
            const m = f.match(/^(\d{4}-\d{2})\./)?.[1];
            if (m && m < cut) { fs.rmSync(path.join(root, acc, f)); n++; }
        }
    }
    return n;
}
