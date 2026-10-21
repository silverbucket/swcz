// One check of a watchlist against ARES, the VAT register and ISIR.
// A source that fails is reported as SOURCE_ERROR and never turned into a "change".
import { getSubject, getVr } from './sources/ares.js';
import { getStatuses, normaliseAccount } from './sources/dph.js';
import { getByIco } from './sources/isir.js';
import { normaliseIco, isValidIco } from './ico.js';
import { matchDomain } from './sources/coi.js';

export async function checkWatchlist(items, { sources = { ares: getSubject, vr: getVr, dph: getStatuses, isir: getByIco }, isirEnabled = true, coi, skip = {}, log = () => {} } = {}) {
    // skip: sources that failed today's self-check ({ ares, dph, isir, coi }); they are reported as errors, never as data.
    const SKIP = 'failed daily self-check';
    // coi: undefined = check not run, null = list unavailable today, { entries } = loaded list.
    const out = [];
    const errors = { ares: 0, dph: 0, isir: 0, coi: 0 };
    let isirDown = false;

    for (const it of items) {
        const ico = normaliseIco(it.ico);
        const row = { ico: ico ?? String(it.ico), label: it.label ?? null, expectedAccount: normaliseAccount(it.expectedAccount) ?? null, checkedAt: new Date().toISOString(), sourceErrors: [] };
        row.website = it.website || null;
        if (!ico || !isValidIco(ico)) { row.invalid = true; out.push(row); continue; }
        if (skip.ares) { errors.ares++; row.sourceErrors.push(`ares: ${SKIP}`); out.push(row); continue; }
        try {
            row.ares = await sources.ares(ico);
        } catch (e) { errors.ares++; row.sourceErrors.push(`ares: ${e.message}`); }
        // Public-register record (statutory body, owners): only for subjects ARES says are in the public register.
        if (row.ares?.found && row.ares.aresPublicRegisterFlag === 'AKTIVNI' && sources.vr) {
            try { row.vr = await sources.vr(ico); } catch (e) { row.sourceErrors.push(`vr: ${e.message}`); }
        }
        out.push(row);
    }

    // VAT register: use the DIČ from ARES when present, else try the IČO (legal entities usually have DIČ = CZ + IČO).
    // Without an ARES answer use the DIČ ARES gave last time (it.dic); a sole trader's DIČ is not CZ + IČO, so
    // guessing would report them as "not in the VAT register". Unknown -> VAT not checked today.
    const valid = out.filter((r) => !r.invalid);
    const dicOf = new Map(items.map((it) => [normaliseIco(it.ico), it.dic]));
    const dicFor = (r) => { const known = dicOf.get(r.ico); const d = r.ares ? r.ares.dic ?? `CZ${r.ico}` : known === undefined ? null : known ?? `CZ${r.ico}`; return d && d.replace(/^CZ/, ''); };
    const vatRows = valid.filter((r) => dicFor(r) !== null);
    if (vatRows.length < valid.length) { errors.dph++; for (const r of valid) if (dicFor(r) === null) r.sourceErrors.push('dph: DIČ unknown while ARES is unavailable'); }
    if (skip.dph) { if (vatRows.length) errors.dph++; for (const r of vatRows) r.sourceErrors.push(`dph: ${SKIP}`); } else try {
        const { generated, subjects } = await sources.dph(vatRows.map(dicFor));
        for (const r of vatRows) {
            const s = subjects.get(dicFor(r));
            r.vat = s ? { ...s, registerDate: generated } : { subjectType: 'NENALEZEN', unreliable: 'NENALEZEN', accounts: [] };
        }
    } catch (e) {
        errors.dph++;
        for (const r of vatRows) r.sourceErrors.push(`dph: ${e.message}`);
    }

    if (isirEnabled) {
        for (const r of valid) {
            if (skip.isir) { errors.isir++; r.sourceErrors.push(`isir: ${SKIP}`); continue; }
            if (isirDown) { r.sourceErrors.push('isir: skipped after connection failure'); continue; }
            try {
                r.isir = await sources.isir(r.ico);
            } catch (e) {
                errors.isir++;
                r.sourceErrors.push(`isir: ${e.message}`);
                if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|TimeoutError|AbortError|UND_ERR/.test(e.message)) isirDown = true;
            }
        }
    }
    if (coi !== undefined) {
        for (const r of valid) {
            if (!r.website) continue;
            if (!coi || skip.coi) { errors.coi++; r.sourceErrors.push(skip.coi ? `coi: ${SKIP}` : 'coi: list unavailable'); continue; }
            r.coi = { matches: matchDomain(coi.entries, r.website).map((e) => ({ domain: e.domain, reason: e.reason, listedOn: e.listedOn })) };
        }
    }
    log(`checked ${out.length}, source errors ${JSON.stringify(errors)}`);
    return { rows: out, errors };
}

// Flatten a row into the facts we compare day to day.
export function facts(r) {
    if (r.invalid) return null;
    const f = {};
    if (r.ares) {
        f.found = r.ares.found;
        f.name = r.ares.name ?? null;
        f.address = r.ares.address ?? null;
        f.dissolved = r.ares.dissolved ?? null;
        f.aresInsolvencyFlag = r.ares.aresInsolvencyFlag ?? null;
        f.aresVatFlag = r.ares.aresVatFlag ?? null;
        f.dic = r.ares.dic ?? null; // not compared; reused for the VAT lookup on a day ARES does not answer
    }
    if (r.vr) { f.statutoryHash = r.vr.statutoryHash; f.ownersHash = r.vr.ownersHash; }
    if (r.vat) {
        f.vatSubjectType = r.vat.subjectType;
        f.unreliable = r.vat.unreliable;
        f.accounts = r.vat.accounts ?? [];
        if (r.expectedAccount) f.expectedAccountPublished = f.accounts.includes(r.expectedAccount);
    }
    // ČOI: no website -> nothing to watch; website but list unavailable -> field omitted (keeps yesterday's).
    if (!r.website) { f.coiDomain = null; f.coiListed = []; } else if (r.coi) { f.coiDomain = r.website; f.coiListed = r.coi.matches.map((m) => m.domain).sort(); }
    if (r.isir) f.isirCases = r.isir.cases.map((c) => `${c.caseNo}|${c.state ?? ''}|${c.ended ?? ''}`).sort();
    return f;
}

// Alerts that hold today, whatever happened before.
export function currentAlerts(r) {
    const f = facts(r);
    if (!f) return ['INVALID_ICO'];
    const a = [];
    if (f.found === false) a.push('NOT_IN_ARES');
    if (f.dissolved) a.push('DISSOLVED');
    if (f.unreliable === 'ANO' || f.vatSubjectType === 'NESPOLEHLIVA_OSOBA') a.push('UNRELIABLE_VAT_PAYER');
    if (r.expectedAccount && f.expectedAccountPublished === false && f.vatSubjectType === 'PLATCE_DPH') a.push('EXPECTED_ACCOUNT_NOT_PUBLISHED');
    const openCases = (r.isir?.cases ?? []).filter((c) => !c.ended);
    if (openCases.length) a.push('INSOLVENCY_PROCEEDING');
    else if (!r.isir && f.aresInsolvencyFlag === 'AKTIVNI') a.push('INSOLVENCY_FLAG_IN_ARES');
    if (/v likvidaci/i.test(f.name ?? '')) a.push('IN_LIQUIDATION');
    if (r.coi?.matches.length) a.push('COI_RISKY_WEBSITE');
    return a;
}

// The fact each alert rests on. An alert counts as new (emailed once) when the stored baseline lacks that fact: the
// supplier is new to the list, or that register did not answer when the supplier was first checked.
export const ALERT_FACT = {
    NOT_IN_ARES: 'found', DISSOLVED: 'dissolved', UNRELIABLE_VAT_PAYER: 'unreliable', EXPECTED_ACCOUNT_NOT_PUBLISHED: 'expectedAccountPublished',
    INSOLVENCY_PROCEEDING: 'isirCases', INSOLVENCY_FLAG_IN_ARES: 'aresInsolvencyFlag', IN_LIQUIDATION: 'name', COI_RISKY_WEBSITE: 'coiListed',
};

const LABELS = {
    name: 'NAME_CHANGED', address: 'ADDRESS_CHANGED', dissolved: 'DISSOLVED_CHANGED', aresInsolvencyFlag: 'ARES_INSOLVENCY_FLAG_CHANGED', aresVatFlag: 'ARES_VAT_FLAG_CHANGED',
    vatSubjectType: 'VAT_REGISTRATION_CHANGED', unreliable: 'UNRELIABLE_STATUS_CHANGED', expectedAccountPublished: 'EXPECTED_ACCOUNT_STATUS_CHANGED', found: 'ARES_PRESENCE_CHANGED', statutoryHash: 'STATUTORY_BODY_CHANGED', ownersHash: 'OWNERS_CHANGED',
};

// Compare with yesterday. Only fields present in both snapshots are compared, so a source
// outage today (missing field) never looks like a change.
export function changes(prevFacts, curFacts) {
    if (!prevFacts || !curFacts) return [];
    const out = [];
    for (const [k, label] of Object.entries(LABELS)) {
        if (!(k in prevFacts) || !(k in curFacts)) continue;
        if (JSON.stringify(prevFacts[k]) !== JSON.stringify(curFacts[k])) out.push({ type: label, from: prevFacts[k], to: curFacts[k] });
    }
    if ('accounts' in prevFacts && 'accounts' in curFacts) {
        for (const a of curFacts.accounts) if (!prevFacts.accounts.includes(a)) out.push({ type: 'BANK_ACCOUNT_ADDED', to: a });
        for (const a of prevFacts.accounts) if (!curFacts.accounts.includes(a)) out.push({ type: 'BANK_ACCOUNT_REMOVED', from: a });
    }
    if ('isirCases' in prevFacts && 'isirCases' in curFacts) {
        for (const c of curFacts.isirCases) if (!prevFacts.isirCases.includes(c)) out.push({ type: 'INSOLVENCY_CASE_NEW_OR_CHANGED', to: c });
    }
    if (curFacts.coiDomain) {
        // A newly added or changed website is compared against "not listed", so an already-listed site alerts once.
        const before = prevFacts.coiDomain === curFacts.coiDomain ? prevFacts.coiListed ?? [] : [];
        for (const d of curFacts.coiListed) if (!before.includes(d)) out.push({ type: 'COI_LISTED', to: d });
        for (const d of before) if (!curFacts.coiListed.includes(d)) out.push({ type: 'COI_DELISTED', from: d });
    }
    return out;
}
