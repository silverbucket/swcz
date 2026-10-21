#!/usr/bin/env node
// Daily job: data-source self-check, then check every confirmed, subscribed account (plan limit applied across
// all its lists), email only when something changed, record history, send last month's PDF report on the 1st.
import fs from 'node:fs';
import path from 'node:path';
import { Accounts } from './accounts.js';
import { createMailer } from './mailer.js';
import { runWatchlist } from './runner.js';
import { checkWatchlist } from './check.js';
import { REGISTER_SOURCES, cachedSources, markRunStart } from './lookups.js';
import { loadCoiList } from './sources/coi.js';
import { runCanary, skipFrom } from './canary.js';
import { pruneHistory, deleteAccountFiles, DEFAULT_HISTORY_MONTHS } from './history.js';
import { sendMonthlyReports } from './monthly.js';

/** Keep only the given suppliers in a list snapshot (facts and latest); rewrites the file only if something goes. */
function trimSnapshot(file, icos) {
    let st; try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    const keep = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => icos.includes(k)));
    const next = { ...st, facts: keep(st.facts), latest: keep(st.latest) };
    if (JSON.stringify(next) === JSON.stringify(st)) return;
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 1)); fs.renameSync(`${file}.tmp`, file);
}

export async function runAll({ env = process.env, dataDir = env.DATA_DIR || 'data', mailer = createMailer(env), check, log = console.error, isirEnabled = env.ISIR_DISABLED !== '1', coiEnabled = env.COI_DISABLED !== '1', loadCoi = loadCoiList, canary = check ? null : runCanary, now = () => Date.now(), sources = REGISTER_SOURCES } = {}) {
    // Every cached register answer is stale from now on: this run fetches each watched IČO once (shared by all
    // lists that watch it, and with free checks) and leaves fresh answers for the free check until the next run.
    markRunStart(dataDir, now());
    const shared = cachedSources(dataDir, { sources, now });
    const doCheck = check ?? ((items, o) => checkWatchlist(items, { ...o, sources: shared }));
    const baseUrl = (env.BASE_URL || 'https://supplierwatch.cz').replace(/\/$/, '');
    const acc = new Accounts(path.join(dataDir, 'accounts.json'), { now });
    const summary = { checked: 0, emailed: 0, failed: 0, sourcesFailed: [], reports: 0 };
    let skip = {};
    if (canary && env.CANARY_DISABLED !== '1') { // tests that inject `check` run without the network canary unless they pass one
        try { const st = await canary({ env, dataDir, mailer, log }); skip = skipFrom(st); summary.sourcesFailed = st.failed; } catch (e) { log(`canary error: ${e.message}`); }
    }
    // ČOI list: downloaded at most once per run, and only if some active account has a website.
    let coi; let coiLoaded = false;
    const getCoi = async () => { if (!coiLoaded) { coiLoaded = true; coi = skip.coi ? null : await loadCoi({ dataDir, log }).catch(() => null); } return coi; };
    const stateDir = path.join(dataDir, 'state'); const stateFiles = fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : [];
    // Accounts are re-read before each list and each email (acc.fresh): an unsubscribe or deletion request made while
    // this run is under way stops register requests and emails for that account at once.
    const active = (x) => Boolean(x?.confirmed && !x.unsubscribed && !x.deleteAt);
    const processed = new Set();
    for (const { id } of acc.all()) {
        const a = acc.fresh(id); if (!a) continue;
        // Register data is kept only for saved suppliers: snapshots of emptied or deleted lists go, and every other
        // snapshot is trimmed to the suppliers still saved on it (suppliers paused by a smaller plan keep theirs).
        const saved = { ...(a.icos?.length ? { [`${a.id}.json`]: a.icos } : {}), ...Object.fromEntries((a.clients ?? []).filter((c) => c.icos.length).map((c) => [`${a.id}--${c.id}.json`, c.icos])) };
        for (const f of stateFiles) {
            if (f !== `${a.id}.json` && !f.startsWith(`${a.id}--`)) continue;
            if (!saved[f]) fs.rmSync(path.join(stateDir, f), { force: true }); else trimSnapshot(path.join(stateDir, f), saved[f]);
        }
        if (!active(a)) continue;
        for (const l of acc.lists(a)) {
            if (!l.icos.length) continue;
            if (!active(acc.fresh(id))) break;
            processed.add(id);
            const items = l.icos.map((ico) => ({ ico, label: null, expectedAccount: null, website: l.websites?.[ico] ?? null }));
            const name = l.clientId ? `${a.id}--${l.clientId}` : a.id;
            try {
                const r = await runWatchlist(items, { name, statePath: path.join(dataDir, 'state', `${name}.json`), outDir: path.join(dataDir, 'reports'), isirEnabled, log, check: doCheck, skip, now, deferState: true, saved: l.clientId ? a.clients.find((c) => c.id === l.clientId).icos : a.icos,
                    coi: coiEnabled && items.some((i) => i.website) ? await getCoi() : undefined, history: { dataDir, accountId: a.id, list: l.key, client: l.name } });
                summary.checked++;
                // Re-read right before every email: an unsubscribe (owner or recipient), a removed recipient or a deletion
                // request made during the register requests or an earlier send stops it.
                const ownerOk = () => active(acc.fresh(id));
                const recipientOk = (rc) => { const x = acc.fresh(id); return active(x) && Boolean(x.clients?.find((c) => c.id === l.clientId)?.recipients?.some((y) => y.email === rc.email && !y.unsubscribed)); };
                if (((r.changed && !r.firstRun) || r.newAlerts) && ownerOk()) {
                    const head = l.name ? `Client / Klient: ${l.name}\n\n` : '';
                    const what = r.changed && !r.firstRun ? ['changes detected', 'Zjištěny změny'] : ['warnings found', 'Nalezena upozornění'];
                    await mailer.send({ to: a.email, unsubscribeUrl: `${baseUrl}/unsubscribe?t=${a.unsubToken}`, subject: `Supplier Watch: ${what[0]}${l.name ? ` (${l.name})` : ''} / ${what[1]}`, text: `${head}${r.text}\n\nEdit your list: ${baseUrl}/?mtm_campaign=alert-email#manage` });
                    for (const rc of l.recipients) if (recipientOk(rc)) await mailer.send({ to: rc.email, unsubscribeUrl: `${baseUrl}/unsubscribe?t=${rc.unsubToken}`, subject: `Supplier Watch: ${what[0]} (${l.name}) / ${what[1]}`, text: `${head}${r.text}\n\nThese alerts were set up for you by ${a.email}.` });
                    summary.emailed++;
                }
                r.saveState(); // only after the alert went out (a throw above leaves yesterday's state, so it re-alerts)
            } catch (e) { summary.failed++; log(`account ${a.id} list ${l.key} failed: ${e.message}`); }
        }
    }
    try { summary.reports = await sendMonthlyReports({ dataDir, acc, mailer, baseUrl, now: new Date(now()), log }); } catch (e) { log(`monthly reports: ${e.message}`); }
    acc.save();
    try { const n = acc.purgeUnconfirmed(); if (n) log(`purged ${n} unconfirmed sign-ups`); } catch (e) { log(`purge: ${e.message}`); }
    try {
        const d = acc.purgeDeleted(); summary.deleted = d.deleted.length;
        if (d.deleted.length) log(`deleted accounts: ${d.deleted.join(', ')}`);
        if (d.waiting.length) log(`deletion due but a paid subscription is still running: ${d.waiting.join(', ')}`);
        if (d.failed.length) log(`account deletion failed, retried tomorrow: ${d.failed.join('; ')}`);
    } catch (e) { log(`account deletion: ${e.message}`); }
    // An account erased while its lists were being checked (node src/admin.js delete) got files written back: remove them.
    for (const id of processed) if (!acc.fresh(id)) { try { deleteAccountFiles(dataDir, id); } catch (e) { log(`cleanup ${id}: ${e.message}`); } }
    try { const n = pruneHistory(dataDir, Number(env.HISTORY_MONTHS || DEFAULT_HISTORY_MONTHS), new Date(now())); if (n) log(`pruned ${n} old history/report files`); } catch (e) { log(`prune: ${e.message}`); }
    return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const s = await runAll(); console.log(JSON.stringify(s)); if (s.failed) process.exitCode = 1;
}
