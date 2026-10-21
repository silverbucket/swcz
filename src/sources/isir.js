// ISIR - Insolvency Register (Ministry of Justice), public SOAP service ISIR_CUZK_WS.
// Documented limits: 50 requests/minute and 3,000/day. Port 8443.
import { XMLParser } from 'fast-xml-parser';
import { request } from './http.js';

export const URL = 'https://isir.justice.cz:8443/isir_cuzk_ws/IsirWsCuzkService';
const parser = new XMLParser({ removeNSPrefix: true, isArray: (n) => n === 'data' });

export function envelope(ico) {
    const ic = String(ico).replace(/\D/g, '');
    return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://isirws.cca.cz/types/"><soapenv:Body><typ:getIsirWsCuzkDataRequest><ic>${ic}</ic><maxPocetVysledku>50</maxPocetVysledku></typ:getIsirWsCuzkDataRequest></soapenv:Body></soapenv:Envelope>`;
}

// Keep only what a supplier check needs; never keep birth dates, personal ID numbers or home addresses.
export function parseResponse(xml) {
    const doc = parser.parse(xml);
    const resp = doc.Envelope?.Body?.getIsirWsCuzkDataResponse;
    if (!resp) throw new Error(`ISIR: unexpected response ${xml.slice(0, 200)}`);
    const code = resp.stav?.kodChyby ?? null;
    if (code && code !== 'WS2') throw new Error(`ISIR ${code}: ${resp.stav?.textChyby ?? ''} ${resp.stav?.popisChyby ?? ''}`.trim());
    const cases = (resp.data ?? []).filter(Boolean).map((d) => ({
        caseNo: `${d.druhVec ?? ''} ${d.bcVec ?? ''}/${d.rocnik ?? ''}`.trim() + (d.cisloSenatu != null ? ` (senát ${d.cisloSenatu})` : ''),
        state: d.druhStavKonkursu ?? null,
        started: d.datumPmZahajeniUpadku ?? null,
        ended: d.datumPmUkonceniUpadku ?? null,
        url: d.urlDetailRizeni ?? null,
    }));
    return { syncedAt: resp.stav?.casSynchronizace ?? null, cases };
}

export async function getByIco(ico, opts = {}) {
    const { status, text } = await request(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
        body: envelope(ico),
        minIntervalMs: 1300, // < 50/min
        timeoutMs: 15000,
        retries: 1,
        ...opts,
    });
    if (status !== 200) throw new Error(`ISIR HTTP ${status}`);
    return parseResponse(text);
}
