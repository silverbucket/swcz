// Registr plátců DPH - Financial Administration public SOAP service for third-party software.
// Unreliable-payer status (nespolehlivý plátce) and published bank accounts; up to 100 DIČ per call.
// The register updates once a day; the service is unavailable 0:00-0:10 (statusCode 2).
import { XMLParser } from 'fast-xml-parser';
import { request } from './http.js';

const URL = 'https://mojedane.gov.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP';
const NS = 'http://adis.mfcr.cz/rozhraniCRPDPH/';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, isArray: (n) => ['statusSubjektu', 'ucet'].includes(n) });

const esc = (s) => String(s).replace(/[^0-9]/g, '');

export function envelope(dics) {
    const items = dics.map((d) => `<roz:dic>${esc(d)}</roz:dic>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:roz="${NS}"><soapenv:Body><roz:StatusNespolehlivySubjektRozsirenyV2Request>${items}</roz:StatusNespolehlivySubjektRozsirenyV2Request></soapenv:Body></soapenv:Envelope>`;
}

// Normalise an account to one comparable key: "prefix-number/bank" for Czech accounts, IBAN otherwise.
export function accountKey(u) {
    if (u.standardniUcet) {
        const s = u.standardniUcet;
        const pre = s.predcisli ? `${String(s.predcisli).replace(/^0+/, '')}-` : '';
        return `${pre}${String(s.cislo).replace(/^0+/, '')}/${s.kodBanky}`;
    }
    if (u.nestandardniUcet) return String(u.nestandardniUcet.cislo).replace(/\s/g, '').toUpperCase();
    return null;
}

export function normaliseAccount(input) {
    const s = String(input ?? '').replace(/\s/g, '').toUpperCase();
    const m = s.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
    if (m) return `${m[1] ? `${m[1].replace(/^0+/, '')}-` : ''}${m[2].replace(/^0+/, '')}/${m[3]}`;
    return s || null;
}

export function parseResponse(xml) {
    const doc = parser.parse(xml);
    const body = doc.Envelope?.Body ?? {};
    const resp = body.StatusNespolehlivySubjektRozsirenyResponse;
    if (!resp) throw new Error(`DPH: unexpected response ${xml.slice(0, 200)}`);
    const code = Number(resp.status?.statusCode);
    if (code !== 0) throw new Error(`DPH statusCode ${code}: ${resp.status?.statusText}`);
    const out = new Map();
    for (const s of resp.statusSubjektu ?? []) {
        const accounts = (s.zverejneneUcty?.ucet ?? []).map((u) => ({ key: accountKey(u), published: u.datumZverejneni ?? null, withdrawn: u.datumZverejneniUkonceni ?? null })).filter((a) => a.key);
        out.set(String(s.dic), {
            dic: String(s.dic),
            subjectType: s.typSubjektu ?? null, // PLATCE_DPH, IDENTIFIKOVANA_OSOBA, SKUPINA_DPH, NESPOLEHLIVA_OSOBA, NENALEZEN...
            unreliable: s.nespolehlivyPlatce ?? null, // ANO / NE / NENALEZEN
            unreliableSince: s.datumZverejneniNespolehlivosti ?? null,
            taxOffice: s.cisloFu ?? null,
            accounts: accounts.filter((a) => !a.withdrawn).map((a) => a.key).sort(),
            accountsPublished: Object.fromEntries(accounts.filter((a) => !a.withdrawn).map((a) => [a.key, a.published])),
        });
    }
    return { generated: resp.status?.odpovedGenerovana ?? null, subjects: out };
}

export async function getStatuses(dics, opts = {}) {
    const result = new Map();
    let generated = null;
    for (let i = 0; i < dics.length; i += 100) {
        const chunk = dics.slice(i, i + 100);
        const { status, text } = await request(URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}getStatusNespolehlivySubjektRozsirenyV2"` },
            body: envelope(chunk),
            minIntervalMs: 1000,
            ...opts,
        });
        if (status !== 200) throw new Error(`DPH HTTP ${status}`);
        const parsed = parseResponse(text);
        generated = parsed.generated;
        for (const [k, v] of parsed.subjects) result.set(k, v);
    }
    return { generated, subjects: result };
}
