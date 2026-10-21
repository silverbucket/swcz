// ČOI (Czech Trade Inspection) "rizikové weby" open dataset.
// Source: https://www.coi.gov.cz/pro-spotrebitele/otevrena-data/rizikove-weby/
// Licence: https://coi.gov.cz/pro-spotrebitele/otevrena-data/licence-otevrenych-dat/
//   (commercial use allowed; must credit "Česká obchodní inspekce", must not imply ČOI endorsement,
//    must not alter meaning, must link the licence when redistributing).
// File is CP1250, one entry per line: domain;'reason text'. No IČO / operator / date fields.
// Used by run.js: loadCoiList() downloads the list once per daily run and caches it in DATA_DIR/coi/.
import fs from 'node:fs';
import path from 'node:path';
export const COI_URL = 'https://www.coi.gov.cz/userdata/files/dokumenty-ke-stazeni/open-data/rizikove-seznam.csv';
export const COI_LICENCE_URL = 'https://coi.gov.cz/pro-spotrebitele/otevrena-data/licence-otevrenych-dat/';
export const COI_CREDIT = 'Zdroj: Česká obchodní inspekce';
export const COI_ATTRIBUTION = 'Zdroj: Česká obchodní inspekce (open data, https://coi.gov.cz/pro-spotrebitele/otevrena-data/licence-otevrenych-dat/)';

export function normalizeDomain(input) {
    if (!input) return '';
    let s = String(input).trim().toLowerCase();
    s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
    s = s.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
    return s;
}

export function decode(buf) {
    return new TextDecoder('windows-1250').decode(buf);
}

export function parseCsv(text) {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const i = line.indexOf(';');
        const url = (i < 0 ? line : line.slice(0, i)).trim();
        let reason = i < 0 ? '' : line.slice(i + 1).trim();
        reason = reason.replace(/^'/, '').replace(/'$/, '').trim();
        const date = reason.match(/\((\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\)/);
        out.push({
            url,
            domain: normalizeDomain(url),
            reason,
            listedOn: date ? `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}` : null,
        });
    }
    return out;
}

export async function fetchRiskyWebs({ fetchImpl = fetch, url = COI_URL, timeoutMs = 30000 } = {}) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'supplier-risk-monitor/0.1' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`coi.gov.cz: HTTP ${res.status}`);
    return parseCsv(decode(new Uint8Array(await res.arrayBuffer())));
}

// Match a supplier's website against the list (exact domain or a listed parent domain).
export function matchDomain(entries, website) {
    const d = normalizeDomain(website);
    if (!d) return [];
    return entries.filter((e) => e.domain && (d === e.domain || d.endsWith('.' + e.domain)));
}

export const COI_MAX_CACHE_AGE_MS = 7 * 24 * 3600e3;

/**
 * Download the list once and cache the raw file in <dataDir>/coi/. If the download fails, fall back
 * to a cached copy younger than maxAgeMs; otherwise return null (callers then skip the ČOI check
 * and infer no changes). Never throws.
 */
export async function loadCoiList({ dataDir, fetchImpl = fetch, url = COI_URL, log = () => {}, now = () => Date.now(), maxAgeMs = COI_MAX_CACHE_AGE_MS } = {}) {
    const dir = path.join(dataDir, 'coi'); const file = path.join(dir, 'rizikove-seznam.csv');
    try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': 'supplierwatch.cz' }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        const entries = parseCsv(decode(buf));
        if (!entries.length) throw new Error('empty list');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${file}.tmp`, buf); fs.renameSync(`${file}.tmp`, file);
        return { entries, fetchedAt: new Date(now()).toISOString(), stale: false };
    } catch (e) {
        try {
            const st = fs.statSync(file);
            if (now() - st.mtimeMs <= maxAgeMs) {
                log(`coi: download failed (${e.message}), using cache from ${st.mtime.toISOString()}`);
                return { entries: parseCsv(decode(fs.readFileSync(file))), fetchedAt: st.mtime.toISOString(), stale: true };
            }
        } catch { /* no cache */ }
        log(`coi: download failed (${e.message}), no usable cache; ČOI check skipped`);
        return null;
    }
}
