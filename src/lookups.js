// Shared register cache (SQLite, next to the accounts): every ARES / public register / VAT / ISIR answer is stored,
// and a register is only asked when no fresh answer exists. An answer is fresh from its fetch until the next daily
// run starts (markRunStart), at most FRESH_MS. The daily run therefore re-fetches every watched IČO and never uses
// an old answer (a failed register is "not checked"). The free check may fall back to an older answer when the
// register does not answer, and shows its date (staleFallback). Failed requests are never cached.
import path from 'node:path';
import { openDb } from './accounts.js';
import { getSubject, getVr } from './sources/ares.js';
import { getStatuses } from './sources/dph.js';
import { getByIco } from './sources/isir.js';

export const REGISTER_SOURCES = { ares: getSubject, vr: getVr, dph: getStatuses, isir: getByIco };
export const FRESH_MS = 36 * 3600e3; // if the daily run stops, answers older than this are re-fetched (kept as fallback)
export const KEEP_DAYS = 30; // register data includes sole traders (personal data): keep fallback answers a month, not forever
const db = (dataDir) => openDb(path.join(dataDir, 'accounts.json'));

/** Start of a daily run: answers fetched before `at` are no longer fresh. Drops answers older than KEEP_DAYS. */
export function markRunStart(dataDir, at = Date.now()) {
    const d = db(dataDir);
    d.prepare("INSERT INTO meta (k, v) VALUES ('lookups_valid_from', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(String(at));
    d.prepare('DELETE FROM lookups WHERE fetched_at < ?').run(at - KEEP_DAYS * 864e5);
}

/** Register sources (same signatures as REGISTER_SOURCES, for checkWatchlist) backed by the shared cache. */
export function cachedSources(dataDir, { sources = REGISTER_SOURCES, now = () => Date.now(), staleFallback = false } = {}) {
    const d = db(dataDir);
    const freshFrom = () => Math.max(Number(d.prepare("SELECT v FROM meta WHERE k = 'lookups_valid_from'").get()?.v ?? 0), now() - FRESH_MS);
    const row = (source, key) => { const r = d.prepare('SELECT data, fetched_at FROM lookups WHERE source = ? AND key = ?').get(source, key); return r ? { value: JSON.parse(r.data), at: r.fetched_at } : null; };
    const fresh = (source, key) => { const r = row(source, key); return r && r.at >= freshFrom() ? r : null; };
    const write = (source, key, value) => d.prepare('INSERT INTO lookups (source, key, data, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(source, key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at')
        .run(source, key, JSON.stringify(value ?? null), now());
    // Register did not answer: an older answer if allowed and present, else the error.
    const fallback = (source, key, e) => { const r = staleFallback && row(source, key); if (r) return r.value; throw e; };
    // The registers a check of this IČO asks, as [source, key], following checkWatchlist: VAT by the DIČ from ARES
    // (else CZ + IČO), the public register only for subjects ARES flags as in it. Unknown until ARES has answered.
    const used = (ico, isir) => {
        const out = [['ares', ico]]; if (isir) out.push(['isir', ico]); // ISIR is asked even when ARES does not answer
        const ares = row('ares', ico); if (!ares) return out;
        out.push(['dph', (ares.value?.dic ?? `CZ${ico}`).replace(/^CZ/, '')]);
        if (ares.value?.found && ares.value.aresPublicRegisterFlag === 'AKTIVNI') out.push(['vr', ico]);
        return out;
    };
    const inFlight = new Map(); // concurrent callers of the same lookup share one request
    const one = (source) => async (key) => {
        const hit = fresh(source, key); if (hit) return hit.value;
        const k = `${source}:${key}`;
        if (!inFlight.has(k)) inFlight.set(k, sources[source](key).then((v) => { write(source, key, v); return v; }).finally(() => inFlight.delete(k)));
        return inFlight.get(k).catch((e) => fallback(source, key, e));
    };
    return {
        ares: one('ares'), vr: one('vr'), isir: one('isir'),
        // VAT register: cached per DIČ, the missing ones fetched in one batch ("not in the register" is an answer too).
        async dph(dics) {
            const subjects = new Map(); let generated = null; const missing = [];
            const use = (dic, v) => { generated = v.generated; if (v.subject) subjects.set(dic, v.subject); };
            for (const dic of dics) { const hit = fresh('dph', dic); if (hit) use(dic, hit.value); else missing.push(dic); }
            if (missing.length) {
                try {
                    const r = await sources.dph(missing);
                    for (const dic of missing) { const v = { generated: r.generated, subject: r.subjects.get(dic) ?? null }; write('dph', dic, v); use(dic, v); }
                } catch (e) { for (const dic of missing) use(dic, fallback('dph', dic, e)); }
            }
            return { generated, subjects };
        },
        /**
         * When the stored answers a check of this IČO uses were fetched: { at: oldest fetch (ms), stale: true if any
         * is not fresh (an older answer was used because a register did not answer) }, or null.
         */
        asOf(ico, { isir = true } = {}) {
            const rows = used(ico, isir).map(([s, k]) => row(s, k)).filter(Boolean);
            if (!rows.length) return null;
            const at = Math.min(...rows.map((r) => r.at)); return { at, stale: at < freshFrom() };
        },
        /** True if every register a check of this IČO asks has a fresh answer (used to skip the free-check rate limit). */
        cached: (ico, { isir = true } = {}) => { const u = used(ico, isir); return u.length > 0 && u.every(([s, k]) => fresh(s, k)); },
    };
}
