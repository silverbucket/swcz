// Daily data-source self-check ("canary"). Looks up a known company in every source and verifies the
// answer has the structure the checks rely on. A source that fails is skipped in that day's customer
// checks (marked "failed", never "all clear") and the ops address (OPS_EMAIL) gets an email.
// Status is stored in DATA_DIR/status.json and shown at /healthz?detail=1 and on /sources.html.
import fs from 'node:fs';
import path from 'node:path';
import { getSubject } from './sources/ares.js';
import { getStatuses } from './sources/dph.js';
import { getByIco } from './sources/isir.js';
import { fetchRiskyWebs } from './sources/coi.js';

export const CANARY_ICO = '27082440'; // Alza.cz a.s.: large, long-standing VAT payer with published accounts
export const SOURCE_NAMES = { ares: 'ARES business register', vat: 'VAT register (Financial Administration)', isir: 'Insolvency register ISIR', coi: 'ČOI risky e-shop list' };
const VAT_TYPES = ['PLATCE_DPH', 'IDENTIFIKOVANA_OSOBA', 'SKUPINA_DPH', 'NESPOLEHLIVA_OSOBA', 'NENALEZEN'];
const must = (cond, msg) => { if (!cond) throw new Error(`unexpected structure: ${msg}`); };

export const PROBES = {
    async ares({ ares = getSubject } = {}) {
        const r = await ares(CANARY_ICO);
        must(r && r.found === true, 'known company not found');
        must(r.ico === CANARY_ICO, 'ico field missing'); must(typeof r.name === 'string' && r.name.length > 2, 'name missing');
        must(typeof r.address === 'string' && r.address.length > 5, 'address missing'); must('aresInsolvencyFlag' in r, 'registration flags missing');
    },
    async vat({ dph = getStatuses } = {}) {
        const { subjects } = await dph([CANARY_ICO]);
        const s = subjects?.get?.(CANARY_ICO);
        must(s, 'known VAT payer missing'); must(VAT_TYPES.includes(s.subjectType), `subject type ${s.subjectType}`);
        must(['ANO', 'NE'].includes(s.unreliable), `unreliable flag ${s.unreliable}`); must(Array.isArray(s.accounts) && s.accounts.length > 0, 'no published accounts');
        must(s.accounts.every((a) => /^(\d+-)?\d+\/\d{4}$|^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(a)), 'account format');
    },
    async isir({ isir = getByIco } = {}) {
        const r = await isir(CANARY_ICO);
        must(r && Array.isArray(r.cases), 'cases array missing');
        must(r.cases.every((c) => typeof c.caseNo === 'string'), 'case number missing');
    },
    async coi({ coi = fetchRiskyWebs } = {}) {
        const e = await coi();
        must(Array.isArray(e) && e.length >= 50, `only ${e?.length ?? 0} entries`);
        must(e.filter((x) => /\.[a-z]{2,}$/.test(x.domain)).length / e.length > 0.9, 'domains do not parse');
    },
};

export function statusFile(dataDir) { return path.join(dataDir, 'status.json'); }
export function readStatus(dataDir) { try { return JSON.parse(fs.readFileSync(statusFile(dataDir), 'utf8')); } catch { return null; } }

/** Run all probes. Returns { checkedAt, ok, sources: { ares: { ok, ms, error? } ... }, failed: [names] }. */
export async function runCanary({ env = process.env, dataDir = env.DATA_DIR || 'data', probes = PROBES, deps = {}, mailer, log = () => {}, now = () => Date.now(), timeoutMs = 60000 } = {}) {
    const sources = {};
    for (const [name, probe] of Object.entries(probes)) {
        if ((name === 'isir' && env.ISIR_DISABLED === '1') || (name === 'coi' && env.COI_DISABLED === '1')) { sources[name] = { ok: true, disabled: true }; continue; }
        const t0 = now();
        let timer;
        try {
            await Promise.race([probe(deps), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs); })]);
            sources[name] = { ok: true, ms: now() - t0 };
        } catch (e) { sources[name] = { ok: false, ms: now() - t0, error: String(e.message).slice(0, 300) }; } finally { clearTimeout(timer); }
    }
    const failed = Object.keys(sources).filter((k) => !sources[k].ok);
    const prev = readStatus(dataDir);
    const st = { checkedAt: new Date(now()).toISOString(), ok: failed.length === 0, sources, failed };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(`${statusFile(dataDir)}.tmp`, JSON.stringify(st, null, 1)); fs.renameSync(`${statusFile(dataDir)}.tmp`, statusFile(dataDir));
    log(`canary: ${failed.length ? `FAILED ${failed.join(', ')}` : 'all sources ok'}`);
    const ops = env.OPS_EMAIL || 'contact@supplierwatch.cz';
    const base = (env.BASE_URL || 'https://supplierwatch.cz').replace(/\/$/, '');
    if (mailer && failed.length) {
        await mailer.send({ to: ops, unsubscribeUrl: `${base}/`, subject: `Supplier Watch ops: data source self-check FAILED (${failed.join(', ')})`,
            text: `The daily self-check failed for: ${failed.map((f) => `${SOURCE_NAMES[f] ?? f}`).join(', ')}.\n\n${failed.map((f) => `${f}: ${sources[f].error}`).join('\n')}\n\nToday's customer checks mark these sources as FAILED (no changes inferred, no "all clear").\nStatus: ${base}/healthz?detail=1` }).catch((e) => log(`canary mail failed: ${e.message}`));
    } else if (mailer && prev && prev.ok === false) {
        await mailer.send({ to: ops, unsubscribeUrl: `${base}/`, subject: 'Supplier Watch ops: all data sources OK again', text: `All data sources passed the self-check at ${st.checkedAt}.` }).catch(() => {});
    }
    return st;
}

/** Map failed canary sources onto the names checkWatchlist uses. */
export const skipFrom = (st) => Object.fromEntries((st?.failed ?? []).map((f) => [f === 'vat' ? 'dph' : f, true]));
