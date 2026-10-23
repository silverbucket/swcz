// Bilingual (EN/CS) plain-text and JSON reports.
import { COI_CREDIT, COI_LICENCE_URL } from './sources/coi.js';
const T = {
    INVALID_ICO: ['Invalid company ID (checksum)', 'Neplatné IČO (kontrolní číslice)'],
    NOT_IN_ARES: ['Not found in ARES', 'Nenalezeno v ARES'],
    DISSOLVED: ['Company dissolved (ARES)', 'Subjekt zanikl (ARES)'],
    UNRELIABLE_VAT_PAYER: ['UNRELIABLE VAT PAYER - you may be liable for its VAT (§109 VAT Act)', 'NESPOLEHLIVÝ PLÁTCE DPH - hrozí ručení za DPH (§ 109 ZDPH)'],
    EXPECTED_ACCOUNT_NOT_PUBLISHED: ['Account you pay is NOT published in the VAT register', 'Účet, na který platíte, NENÍ zveřejněn v registru DPH'],
    INSOLVENCY_PROCEEDING: ['Insolvency proceeding in ISIR', 'Insolvenční řízení v ISIR'],
    INSOLVENCY_FLAG_IN_ARES: ['ARES shows an insolvency-register record (ISIR not reachable, check manually)', 'ARES uvádí záznam v insolvenčním rejstříku (ISIR nedostupný, ověřte ručně)'],
    IN_LIQUIDATION: ['In liquidation', 'V likvidaci'],
    NAME_CHANGED: ['Name changed', 'Změna názvu'],
    ADDRESS_CHANGED: ['Registered address changed', 'Změna sídla'],
    DISSOLVED_CHANGED: ['Dissolution date changed', 'Změna data zániku'],
    ARES_INSOLVENCY_FLAG_CHANGED: ['Insolvency flag in ARES changed', 'Změna příznaku insolvence v ARES'],
    ARES_VAT_FLAG_CHANGED: ['VAT flag in ARES changed', 'Změna příznaku DPH v ARES'],
    VAT_REGISTRATION_CHANGED: ['VAT registration type changed', 'Změna registrace k DPH'],
    UNRELIABLE_STATUS_CHANGED: ['Unreliable-payer status changed', 'Změna statusu nespolehlivého plátce'],
    EXPECTED_ACCOUNT_STATUS_CHANGED: ['Status of the account you pay changed', 'Změna zveřejnění účtu, na který platíte'],
    ARES_PRESENCE_CHANGED: ['Presence in ARES changed', 'Změna existence v ARES'],
    BANK_ACCOUNT_ADDED: ['Published bank account added', 'Nový zveřejněný účet'],
    BANK_ACCOUNT_REMOVED: ['Published bank account removed', 'Zveřejněný účet odebrán'],
    COI_RISKY_WEBSITE: ["Supplier's website is on the ČOI list of risky e-shops", 'Web dodavatele je na seznamu rizikových e-shopů ČOI'],
    COI_LISTED: ["Website newly added to the ČOI list of risky e-shops", 'Web nově zařazen na seznam rizikových e-shopů ČOI'],
    COI_DELISTED: ['Website removed from the ČOI list of risky e-shops', 'Web vyřazen ze seznamu rizikových e-shopů ČOI'],
    STATUTORY_BODY_CHANGED: ['Statutory body (directors/board) changed in the public register', 'Změna statutárního orgánu ve veřejném rejstříku'],
    OWNERS_CHANGED: ['Owners (partners/sole shareholder) changed in the public register', 'Změna společníků / jediného akcionáře ve veřejném rejstříku'],
    INSOLVENCY_CASE_NEW_OR_CHANGED: ['New or changed insolvency case', 'Nové nebo změněné insolvenční řízení'],
};
const t = (k) => T[k] ?? [k, k];
const SRC_NAME = { ares: 'ARES', dph: 'VAT register / registr DPH', isir: 'ISIR', coi: 'ČOI' };

export function buildReport(result, { watchlist = 'watchlist', firstRun = false, coiUsed = false, coiListDate = null } = {}) {
    const items = result.items;
    const flagged = items.filter((i) => i.alerts.length || i.changes.length);
    const lines = [];
    const when = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
    lines.push(`Supplier check / Kontrola dodavatelů - ${watchlist} - ${when} (Prague time / čas Praha)`);
    lines.push(`Checked / Zkontrolováno: ${items.length} | Needs attention / Vyžaduje pozornost: ${flagged.length}${firstRun ? ' | First run: baseline stored / První běh: uložen výchozí stav' : ''}`);
    if (result.errors && Object.values(result.errors).some(Boolean)) lines.push(`Source problems / Nedostupné zdroje: ${JSON.stringify(result.errors)} (no changes inferred / změny se z výpadku neodvozují)`);
    lines.push('');
    for (const i of flagged) {
        lines.push(`■ ${i.name ?? '?'} (IČO ${i.ico})${i.label ? ` [${i.label}]` : ''}`);
        for (const a of i.alerts) lines.push(`   ! ${t(a)[0]} / ${t(a)[1]}`);
        for (const c of i.changes) {
            if (c.type === 'STATUTORY_BODY_CHANGED' || c.type === 'OWNERS_CHANGED') { lines.push(`   Δ ${t(c.type)[0]} / ${t(c.type)[1]}: https://or.justice.cz/ias/ui/rejstrik-$firma?ico=${i.ico}`); continue; }
            const v = 'from' in c && 'to' in c ? `${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}` : JSON.stringify(c.to ?? c.from);
            lines.push(`   Δ ${t(c.type)[0]} / ${t(c.type)[1]}: ${v}`);
        }
        if (i.unreliableSince) lines.push(`     unreliable since / nespolehlivý od: ${i.unreliableSince}`);
        for (const c of i.insolvencyCases ?? []) lines.push(`     ISIR ${c.caseNo} ${c.state ?? ''} ${c.url ?? ''}`);
        for (const m of i.coiMatches ?? []) lines.push(`     ČOI ${m.domain}${m.listedOn ? ` (${m.listedOn})` : ''}: ${m.reason}`);
        for (const e of i.sourceErrors) lines.push(`     (source / zdroj: ${e})`);
        lines.push('');
    }
    const failedSrc = Object.entries(result.errors ?? {}).filter(([, n]) => n).map(([k]) => SRC_NAME[k] ?? k);
    if (failedSrc.length) {
        lines.push(`! NOT CHECKED today (source failed): ${failedSrc.join(', ')}. This is NOT an all-clear for these checks. / NEZKONTROLOVÁNO (výpadek zdroje): ${failedSrc.join(', ')}. Nejde o potvrzení, že je vše v pořádku.`);
        lines.push('');
    }
    if (coiListDate) {
        const d = coiListDate.slice(0, 10);
        lines.push(`ČOI list could not be downloaded today; websites were checked against the saved copy from ${d}. / Seznam ČOI dnes nešlo stáhnout; weby byly porovnány s uloženou kopií z ${d}.`);
        lines.push('');
    }
    if (!flagged.length) lines.push(failedSrc.length ? 'No alerts or changes in the sources that answered. / Žádná upozornění ani změny ve zdrojích, které odpověděly.' : 'No alerts or changes. / Žádná upozornění ani změny.');
    lines.push('');
    lines.push('Sources: ARES (MF ČR), Registr plátců DPH (Finanční správa), ISIR (MSp ČR). Informational only - verify in the official register before any payment decision.');
    lines.push('Zdroje: ARES, Registr plátců DPH, ISIR. Pouze informativní - před rozhodnutím o platbě ověřte údaje v oficiálním registru.');
    if (coiUsed || items.some((i) => i.coiMatches?.length)) {
        lines.push(`${COI_CREDIT} (seznam rizikových e-shopů, otevřená data; licence: ${COI_LICENCE_URL}). Supplier Watch is not affiliated with or endorsed by ČOI. / Supplier Watch není s ČOI spojen ani jí doporučen.`);
    }
    return lines.join('\n');
}
