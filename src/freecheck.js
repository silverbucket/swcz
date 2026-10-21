// Free one-off "check one IČO" page: runs the same checks as the daily monitor, once, without an account.
// Abuse limits: per-IP (default 5 per hour) and a global cap (default 60 per hour, so with the daily run we stay
// under ISIR's 3,000 calls a day), both in memory. Each IČO is looked up at most once per Prague day.
import { checkWatchlist, currentAlerts } from './check.js';
import { normaliseIco, isValidIco } from './ico.js';
import { loadCoiList, normalizeDomain, matchDomain, COI_LICENCE_URL, COI_CREDIT } from './sources/coi.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class RateLimiter {
    constructor({ perIp = 5, global = 200, windowMs = 3600e3, now = () => Date.now() } = {}) { Object.assign(this, { perIp, global, windowMs, now }); this.hits = new Map(); this.all = []; }
    allow(ip) {
        const t = this.now(); const cut = t - this.windowMs;
        this.all = this.all.filter((x) => x > cut);
        const mine = (this.hits.get(ip) ?? []).filter((x) => x > cut);
        if (mine.length >= this.perIp || this.all.length >= this.global) { this.hits.set(ip, mine); return false; }
        mine.push(t); this.hits.set(ip, mine); this.all.push(t);
        if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some((x) => x > cut)) this.hits.delete(k);
        return true;
    }
}

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|::ffff:(127|10|192\.168)\.)/i;
/**
 * Client IP: nginx appends the peer to X-Forwarded-For, and anything to its left is client-supplied (spoofable).
 * So take the rightmost entry that is not one of our own (private/loopback) proxies.
 */
export function clientIp(req) {
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return xff.reverse().find((ip) => !PRIVATE_IP.test(ip)) || xff[0] || req.socket?.remoteAddress || 'unknown';
}

const ALERT_TEXT = {
    NOT_IN_ARES: 'Not found in the ARES business register', DISSOLVED: 'Company dissolved (date of dissolution in ARES)',
    UNRELIABLE_VAT_PAYER: 'Published as an UNRELIABLE VAT PAYER (nespolehlivý plátce)', INSOLVENCY_PROCEEDING: 'Open insolvency proceeding in ISIR',
    INSOLVENCY_FLAG_IN_ARES: 'ARES shows an insolvency record', IN_LIQUIDATION: 'Name says "v likvidaci" (in liquidation)', COI_RISKY_WEBSITE: 'Website is on the ČOI list of risky e-shops',
};

/** Standalone static page (site/check.html), served by nginx. */
export function checkPageHtml(page) { return page('Check a Czech supplier by IČO', checkForm()); }

export function checkForm({ ico = '', web = '', error = '' } = {}) {
    return `<h1>Check one Czech supplier / Ověřit dodavatele</h1>
<p>Free one-off check of a Czech company by IČO in the official registers: ARES (business register), the VAT register (unreliable payer status and published bank accounts), the insolvency register ISIR and, if you enter a website, the ČOI list of risky e-shops. No account needed.</p>
${error ? `<p class="sw-err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/manage-link?freecheck=1"><div class="sw-row"><input name="ico" inputmode="numeric" maxlength="10" required placeholder="IČO (8 digits)" aria-label="IČO" value="${esc(ico)}"><input name="web" placeholder="website (optional), e.g. firma.cz" aria-label="Website (optional)" value="${esc(web)}"></div>
<p style="display:none"><label>Fax <input name="fax" tabindex="-1" autocomplete="off"></label></p><button>Check / Ověřit</button></form>
<p class="muted">Limited to a few checks per hour. Results come straight from the public registers at the moment you check; they are information, not legal or tax advice.</p>`;
}

export function renderResult(r, { coiUsed }) {
    const alerts = currentAlerts(r); const a = r.ares ?? {}; const v = r.vat; const rows = [];
    rows.push(['Name', a.found === false ? 'not found in ARES' : esc(a.name ?? '?')]);
    if (a.address) rows.push(['Registered address', esc(a.address)]);
    if (a.dic) rows.push(['VAT ID (DIČ)', esc(a.dic)]);
    if (v) {
        const reg = { PLATCE_DPH: 'VAT payer', NESPOLEHLIVA_OSOBA: 'unreliable person (not a VAT payer)', IDENTIFIKOVANA_OSOBA: 'identified person', SKUPINA_DPH: 'VAT group member', NENALEZEN: 'not in the VAT register' }[v.subjectType] ?? esc(v.subjectType ?? '?');
        rows.push(['VAT register', reg]);
        rows.push(['Unreliable VAT payer', v.unreliable === 'ANO' ? '<strong>YES</strong>' : v.unreliable === 'NE' ? 'no' : 'n/a']);
        rows.push(['Published bank accounts', v.accounts?.length ? v.accounts.map(esc).join('<br>') : 'none']);
    }
    if (r.isir) rows.push(['Insolvency register (ISIR)', r.isir.cases.length ? r.isir.cases.map((c) => `${esc(c.caseNo)}${c.state ? ` (${esc(c.state)})` : ''}${c.ended ? ' ended' : ''}`).join('<br>') : 'no proceedings found']);
    if (r.website) rows.push([`ČOI risky e-shops (${esc(r.website)})`, r.coi ? (r.coi.matches.length ? `<strong>LISTED</strong>: ${r.coi.matches.map((m) => esc(`${m.domain}${m.reason ? ` - ${m.reason}` : ''}`)).join('<br>')}` : 'not listed') : 'list unavailable today']);
    const errs = r.sourceErrors.length ? `<p class="muted">Some registers did not answer: ${esc(r.sourceErrors.join('; '))}. Try again later.</p>` : '';
    return `<h1>${esc(a.name ?? r.ico)} · IČO ${esc(r.ico)}</h1>
${alerts.length ? `<p class="sw-err"><strong>Warnings:</strong><br>${alerts.map((x) => esc(ALERT_TEXT[x] ?? x)).join('<br>')}</p>` : '<p><strong>No warnings found in the checked registers today.</strong></p>'}
<table>${rows.map(([k, val]) => `<tr><th style="text-align:left;vertical-align:top;padding:.2rem 1rem .2rem 0">${k}</th><td>${val}</td></tr>`).join('')}</table>${errs}
<p class="muted">Checked ${esc(new Date(r.checkedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC. Sources: ARES, Financial Administration VAT register, ISIR${coiUsed ? `, <a href="${COI_LICENCE_URL}">${COI_CREDIT}</a> (Supplier Watch is not affiliated with or endorsed by ČOI)` : ''}. Information only, not legal or tax advice.</p>
<h2>Get an email when this changes</h2>
<p>A supplier can become an unreliable VAT payer, change its bank accounts or enter insolvency at any time. Supplier Watch checks your suppliers every morning and emails you only when something changes. Free for up to 5 suppliers.</p>
<p><a class="cta" href="/#signup">Watch this supplier for free</a> <a href="/check.html">Check another IČO</a> · <a href="/guides/">Guides</a></p>`;
}

export function createFreeCheck({ env = process.env, dataDir, check = checkWatchlist, loadCoi = loadCoiList, limiter = new RateLimiter({ perIp: Number(env.FREECHECK_PER_IP || 5), global: Number(env.FREECHECK_GLOBAL || 60) }), now = () => Date.now() } = {}) {
    let coiCache = null; let coiAt = 0; const cache = new Map(); let cacheDay = ''; // IČO -> check row, for today only
    const getCoi = async () => { if (!coiCache || now() - coiAt > 6 * 3600e3) { coiCache = await loadCoi({ dataDir }).catch(() => null); coiAt = now(); } return coiCache; };
    return async function handleCheck(req, form, page) {
        if (req.method !== 'POST') return [200, page('Check a Czech supplier by IČO', checkForm())];
        const ico = normaliseIco(form.ico); const web = String(form.web ?? '').trim();
        if (form.fax) return [200, page('Check', checkForm())];
        if (!ico || !isValidIco(ico)) return [400, page('Check a Czech supplier by IČO', checkForm({ ico: form.ico, web, error: 'That is not a valid IČO (8 digits with a checksum). / Neplatné IČO.' }))];
        const website = web ? normalizeDomain(web) : null;
        if (web && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(website)) return [400, page('Check a Czech supplier by IČO', checkForm({ ico, web, error: 'That website does not look like a domain, e.g. firma.cz.' }))];
        const day = new Date(now()).toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' });
        if (day !== cacheDay) { cache.clear(); cacheDay = day; }
        let row = cache.get(ico);
        if (!row) { // cached answers skip the limits: they cost the registers nothing
            if (!limiter.allow(clientIp(req))) return [429, page('Too many checks', `<p>Too many checks for now. Please try again in an hour, or <a href="/#signup">sign up free</a> to have up to 5 suppliers checked every day.</p>`)];
            row = (await check([{ ico }], { isirEnabled: env.ISIR_DISABLED !== '1' })).rows[0];
            if (!row.sourceErrors.length) cache.set(ico, row); // a failed source is retried by the next check
        }
        // ČOI depends on the website entered, so it is matched per request against the (cached) list.
        const coi = website && env.COI_DISABLED !== '1' ? await getCoi() : undefined;
        const r = { ...row, website: website || null, sourceErrors: [...row.sourceErrors] };
        if (coi) r.coi = { matches: matchDomain(coi.entries, website).map((e) => ({ domain: e.domain, reason: e.reason, listedOn: e.listedOn })) };
        else if (coi === null) r.sourceErrors.push('coi: list unavailable');
        return [200, page(`Check result ${ico}`, renderResult(r, { coiUsed: !!website && coi !== undefined }))];
    };
}
