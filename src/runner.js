// Run one watchlist: check, diff against stored state, write reports. Shared by cli.js and run.js.
import fs from 'node:fs';
import path from 'node:path';
import { checkWatchlist, facts, currentAlerts, changes, ALERT_FACT } from './check.js';
import { buildReport } from './report.js';
import { recordFor, appendHistory } from './history.js';
import { normaliseIco } from './ico.js';

export async function runWatchlist(items, { name, statePath, outDir, isirEnabled = true, coi, skip = {}, log = () => {}, check = checkWatchlist, history, now = () => Date.now(), deferState = false, saved }) {
    // history: { dataDir, accountId, list, client } -> append one record per supplier to the check history.
    // saved: every supplier saved on the list (default: items). Suppliers over the plan limit aren't checked but keep
    // their snapshot, so an upgrade compares against it again.
    // deferState: today's results (latest, for the API) are stored at once, but the comparison baseline (facts) only
    // when the caller calls saveState() once the alert email is out, so a mail failure re-detects the change tomorrow.
    const prev = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { facts: {} };
    const firstRun = Object.keys(prev.facts).length === 0;
    const res = await check(items.map((i) => ({ ...i, dic: prev.facts[normaliseIco(i.ico)]?.dic })), { isirEnabled, coi, skip, log });
    // Only suppliers still on the list: register data of a removed supplier is deleted with it (privacy policy).
    const onList = new Set((saved ?? items.map((i) => i.ico)).map(normaliseIco));
    const kept = Object.fromEntries(Object.entries(prev.facts).filter(([k]) => onList.has(k)));
    const nextFacts = { ...kept };
    const reportItems = res.rows.map((r) => {
        const f = facts(r);
        // Merge so that a field missing today (source outage) keeps yesterday's value.
        if (f) nextFacts[r.ico] = { ...(prev.facts[r.ico] ?? {}), ...f };
        return {
            ico: r.ico, label: r.label, name: r.ares?.name ?? null, address: r.ares?.address ?? null, naturalPerson: r.ares?.naturalPerson ?? null,
            alerts: currentAlerts(r), changes: changes(prev.facts[r.ico], f),
            unreliableSince: r.vat?.unreliableSince ?? null, vatSubjectType: r.vat?.subjectType ?? null,
            publishedAccounts: r.vat?.accounts ?? null, expectedAccount: r.expectedAccount,
            insolvencyCases: r.isir?.cases ?? null, aresInsolvencyFlag: r.ares?.aresInsolvencyFlag ?? null,
            website: r.website ?? null, coiMatches: r.coi?.matches ?? null,
            sourceErrors: r.sourceErrors,
        };
    });
    const at = new Date(now()).toISOString();
    const coiRun = coi !== undefined;
    const records = reportItems.map((i) => recordFor(i, { at, list: history?.list ?? 'main', client: history?.client ?? null, isirEnabled, coiRun, coiListDate: coi?.stale ? coi.fetchedAt : null }));
    const latest = { ...(prev.latest ?? {}) };
    for (const r of records) latest[r.ico] = r;
    for (const k of Object.keys(latest)) if (!onList.has(k)) delete latest[k];
    const write = (baseline) => {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ updatedAt: at, facts: baseline, latest }, null, 1)); fs.renameSync(`${statePath}.tmp`, statePath);
    };
    const saveState = () => write(nextFacts);
    write(deferState ? kept : nextFacts);
    if (history) appendHistory(history.dataDir, history.accountId, records, new Date(now()));
    const result = { watchlist: name, firstRun, errors: res.errors, items: reportItems };
    const text = buildReport(result, { watchlist: name, firstRun, coiUsed: !!coi && items.some((i) => i.website), coiListDate: coi?.stale && items.some((i) => i.website) ? coi.fetchedAt : null });
    if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(path.join(outDir, `${name}-${stamp}.json`), JSON.stringify(result, null, 1));
        fs.writeFileSync(path.join(outDir, `${name}-${stamp}.txt`), text);
    }
    const changed = reportItems.some((i) => i.changes.length);
    // A warning that holds since before we had a baseline for it (e.g. a new supplier that is already an unreliable
    // payer) is reported once; it is not a "change".
    const newAlerts = reportItems.some((i) => i.alerts.some((al) => ALERT_FACT[al] && !(ALERT_FACT[al] in (prev.facts[i.ico] ?? {}))));
    return { result, text, firstRun, changed, newAlerts, records, saveState };
}
