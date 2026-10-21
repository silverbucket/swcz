// Shared register cache (SQLite, next to the accounts): every ARES / public register / VAT / ISIR answer is stored,
// and a register is only asked when no valid answer exists. The daily run invalidates everything when it starts
// (markRunStart) and so refreshes every watched IČO; the free check reuses those answers and stores its own.
// Only answers are cached; a failed request is retried by the next caller.
import path from 'node:path';
import { openDb } from './accounts.js';
import { getSubject, getVr } from './sources/ares.js';
import { getStatuses } from './sources/dph.js';
import { getByIco } from './sources/isir.js';

export const REGISTER_SOURCES = { ares: getSubject, vr: getVr, dph: getStatuses, isir: getByIco };
export const MAX_AGE_MS = 36 * 3600e3; // backstop if the daily run stops: never serve an older answer
const db = (dataDir) => openDb(path.join(dataDir, 'accounts.json'));

/** Start of a daily run: answers fetched before `at` are no longer valid. Also drops week-old rows. */
export function markRunStart(dataDir, at = Date.now()) {
    const d = db(dataDir);
    d.prepare("INSERT INTO meta (k, v) VALUES ('lookups_valid_from', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(String(at));
    d.prepare('DELETE FROM lookups WHERE fetched_at < ?').run(at - 7 * 864e5);
}

/** Register sources (same signatures as REGISTER_SOURCES, for checkWatchlist) backed by the shared cache. */
export function cachedSources(dataDir, { sources = REGISTER_SOURCES, now = () => Date.now() } = {}) {
    const d = db(dataDir);
    const validFrom = () => Math.max(Number(d.prepare("SELECT v FROM meta WHERE k = 'lookups_valid_from'").get()?.v ?? 0), now() - MAX_AGE_MS);
    const read = (source, key) => { const r = d.prepare('SELECT data FROM lookups WHERE source = ? AND key = ? AND fetched_at >= ?').get(source, key, validFrom()); return r ? { value: JSON.parse(r.data) } : null; };
    const write = (source, key, value) => d.prepare('INSERT INTO lookups (source, key, data, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(source, key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at')
        .run(source, key, JSON.stringify(value ?? null), now());
    const inFlight = new Map(); // concurrent callers of the same lookup share one request
    const one = (source) => async (key) => {
        const hit = read(source, key); if (hit) return hit.value;
        const k = `${source}:${key}`;
        if (!inFlight.has(k)) inFlight.set(k, sources[source](key).then((v) => { write(source, key, v); return v; }).finally(() => inFlight.delete(k)));
        return inFlight.get(k);
    };
    return {
        ares: one('ares'), vr: one('vr'), isir: one('isir'),
        // VAT register: cached per DIČ, the missing ones fetched in one batch ("not in the register" is an answer too).
        async dph(dics) {
            const subjects = new Map(); let generated = null; const missing = [];
            for (const dic of dics) { const hit = read('dph', dic); if (!hit) missing.push(dic); else { generated = hit.value.generated; if (hit.value.subject) subjects.set(dic, hit.value.subject); } }
            if (missing.length) {
                const r = await sources.dph(missing); generated = r.generated;
                for (const dic of missing) { const s = r.subjects.get(dic) ?? null; write('dph', dic, { generated: r.generated, subject: s }); if (s) subjects.set(dic, s); }
            }
            return { generated, subjects };
        },
        /** When the oldest cached ARES / ISIR answer for this IČO was fetched (ms), or null. */
        fetchedAt: (ico) => d.prepare("SELECT min(fetched_at) AS t FROM lookups WHERE key = ? AND source IN ('ares', 'isir') AND fetched_at >= ?").get(ico, validFrom())?.t ?? null,
        /** True if a check of this IČO needs no ARES or ISIR request (used to skip the free-check rate limit). */
        cached: (ico, { isir = true } = {}) => Boolean(read('ares', ico) && (!isir || read('isir', ico))),
    };
}
