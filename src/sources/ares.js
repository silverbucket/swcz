// ARES - Administrative Register of Economic Subjects (Ministry of Finance), public REST API.
// https://ares.gov.cz/ekonomicke-subjekty-v-be/rest
import crypto from 'node:crypto';
import { request } from './http.js';

const BASE = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';

// Legal forms 100-108 are natural persons (sole traders); treated as personal data.
export const isNaturalPerson = (pravniForma) => /^10\d$/.test(String(pravniForma ?? ''));

export function parseAres(json) {
    const r = json.seznamRegistraci ?? {};
    return {
        ico: json.ico,
        name: json.obchodniJmeno ?? null,
        dic: json.dic ?? null,
        legalForm: json.pravniForma ?? null,
        naturalPerson: isNaturalPerson(json.pravniForma),
        address: json.sidlo?.textovaAdresa ?? null,
        founded: json.datumVzniku ?? null,
        dissolved: json.datumZaniku ?? null,
        aresUpdated: json.datumAktualizace ?? null,
        // ARES mirrors whether the subject appears in the insolvency register (ISIR) and the
        // central register of bankrupts (CEU): AKTIVNI = present, NEEXISTUJICI = not present.
        aresInsolvencyFlag: r.stavZdrojeIr ?? null,
        aresBankruptFlag: r.stavZdrojeCeu ?? null,
        aresVatFlag: r.stavZdrojeDph ?? null,
        aresPublicRegisterFlag: r.stavZdrojeVr ?? null,
    };
}

export async function getSubject(ico, opts = {}) {
    const { status, text } = await request(`${BASE}/${ico}`, { headers: { Accept: 'application/json' }, ...opts });
    if (status === 404) return { found: false };
    if (status !== 200) throw new Error(`ARES HTTP ${status}`);
    return { found: true, ...parseAres(JSON.parse(text)) };
}

// ARES public-register (VR) record: current statutory body members and owners (shareholders/partners).
// Only short fingerprints are kept (no names, birth dates or addresses), so a change can be detected
// without storing personal data. Details are in the public register (or.justice.cz).
const VR = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty-vr';
const current = (xs) => (xs ?? []).filter((x) => x && !x.datumVymazu);
const who = (m) => {
    const f = m?.fyzickaOsoba; const p = m?.pravnickaOsoba ?? m?.osoba?.pravnickaOsoba;
    const fo = f ?? m?.osoba?.fyzickaOsoba;
    if (fo) return `F:${String(fo.jmeno ?? '').trim()} ${String(fo.prijmeni ?? '').trim()}|${fo.datumNarozeni ?? ''}`.toLowerCase();
    if (p) return `P:${p.ico ?? ''}|${String(p.obchodniJmeno ?? '').trim()}`.toLowerCase();
    return null;
};
const fp = (list) => (list.length ? crypto.createHash('sha256').update(list.sort().join('\n')).digest('hex').slice(0, 16) : 'none');
export function parseVr(json) {
    const z = (json?.zaznamy ?? []).find((x) => x.primarniZaznam) ?? json?.zaznamy?.[0];
    if (!z) throw new Error('ARES VR: no record');
    const statutory = current(z.statutarniOrgany).flatMap((o) => current(o.clenoveOrganu).map((m) => `${o.typOrganu ?? ''}:${who(m)}`)).filter((x) => !x.endsWith(':null'));
    const owners = [...current(z.spolecnici).flatMap((s) => current(s.spolecnik).map((m) => who(m.osoba ?? m))), ...current(z.akcionari).flatMap((a) => current(a.clenoveOrganu ?? [a]).map((m) => who(m.osoba ?? m)))].filter(Boolean);
    return { statutoryHash: fp(statutory), statutoryCount: statutory.length, ownersHash: fp(owners), ownersCount: owners.length };
}
export async function getVr(ico, opts = {}) {
    const { status, text } = await request(`${VR}/${ico}`, { headers: { Accept: 'application/json' }, ...opts });
    if (status === 404) return null;
    if (status !== 200) throw new Error(`ARES VR HTTP ${status}`);
    return parseVr(JSON.parse(text));
}
