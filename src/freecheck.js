// Free one-off "check one IČO" page: runs the same checks as the daily monitor, once, without an account.
// Abuse limits: per-IP (default 5 per hour) and a global cap (default 60 per hour, so with the daily run we stay
// under ISIR's 3,000 calls a day), both in memory. Register answers come from the shared cache (lookups.js), so an
// IČO the daily run already checked costs the registers nothing and does not count against the limits. The hourly
// health check (health.js) is exempt.
import { checkWatchlist, currentAlerts } from './check.js';
import { normaliseIco, isValidIco } from './ico.js';
import { loadCoiList, normalizeDomain, COI_LICENCE_URL, COI_CREDIT } from './sources/coi.js';
import { REGISTER_SOURCES, cachedSources } from './lookups.js';
import { monitoringEnabled } from './site.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Drop timestamps older than `cut` from a key -> [timestamps] map, and keys left with none. */
export function sweepHits(hits, cut) { for (const [k, v] of hits) { const keep = v.filter((x) => x > cut); if (keep.length) hits.set(k, keep); else hits.delete(k); } }

export class RateLimiter {
    constructor({ perIp = 5, global = 200, windowMs = 3600e3, now = () => Date.now() } = {}) {
        Object.assign(this, { perIp, global, windowMs, now }); this.hits = new Map(); this.all = [];
        setInterval(() => this.sweep(), Math.min(windowMs, 60e3)).unref(); // privacy policy: IPs go after one window, traffic or not
    }
    sweep() { const cut = this.now() - this.windowMs; this.all = this.all.filter((x) => x > cut); sweepHits(this.hits, cut); }
    allow(ip) {
        this.sweep();
        const mine = this.hits.get(ip) ?? [];
        if (mine.length >= this.perIp || this.all.length >= this.global) return false; // a refused IP is not stored
        mine.push(this.now()); this.hits.set(ip, mine); this.all.push(this.now());
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

/** ok: every register answered; stale: a register is down, older answers shown; partial: some answered; error: none did. */
export function resultStatus(r, stale = false) {
    if (!r.sourceErrors.length) return stale ? 'stale' : 'ok';
    return r.ares || r.vat || r.isir ? 'partial' : 'error';
}

export function renderResult(r, { coiUsed, stale = false, monitoring = true }) {
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
    return `<h1 data-result="${resultStatus(r, stale)}">${esc(a.name ?? r.ico)} · IČO ${esc(r.ico)}</h1>
${alerts.length ? `<p class="sw-err"><strong>Warnings:</strong><br>${alerts.map((x) => esc(ALERT_TEXT[x] ?? x)).join('<br>')}</p>` : '<p><strong>No warnings found in the checked registers today.</strong></p>'}
<table>${rows.map(([k, val]) => `<tr><th style="text-align:left;vertical-align:top;padding:.2rem 1rem .2rem 0">${k}</th><td>${val}</td></tr>`).join('')}</table>${errs}
${stale ? `<p class="sw-err">A register did not answer just now, so this shows the last answer we have, from ${esc(new Date(r.checkedAt).toISOString().slice(0, 10))}. It may be out of date; check again later. / Registr právě neodpovídá, zobrazujeme poslední známá data, mohou být zastaralá.</p>` : ''}
<p class="muted">Register data from ${esc(new Date(r.checkedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC. Sources: ARES, Financial Administration VAT register, ISIR${coiUsed ? `, <a href="${COI_LICENCE_URL}">${COI_CREDIT}</a> (Supplier Watch is not affiliated with or endorsed by ČOI)` : ''}. Information only, not legal or tax advice.</p>
<div data-track-content data-content-name="Free check: watch CTA">${monitoring ? `<h2>Get an email when this changes</h2>
<p>A supplier can become an unreliable VAT payer, change its bank accounts or enter insolvency at any time. Supplier Watch checks your suppliers every morning and emails you only when something changes. Free for up to 5 suppliers.</p>
<p><a class="cta" href="/#signup">Watch this supplier for free</a> <a href="/check.html">Check another IČO</a> · <a href="/guides/">Guides</a></p>` : `<h2>Want to know when this changes?</h2>
<p>A supplier can become an unreliable VAT payer, change its bank accounts or enter insolvency at any time. We're working on daily monitoring that emails you when something changes; leave your email and we'll tell you when it's ready.</p>
<p><a class="cta" href="/#updates">Get updates</a> <a href="/check.html">Check another IČO</a> · <a href="/guides/">Guides</a></p>`}</div>`;
}

export function createFreeCheck({ env = process.env, dataDir, check = checkWatchlist, sources = REGISTER_SOURCES, loadCoi = loadCoiList, limiter = new RateLimiter({ perIp: Number(env.FREECHECK_PER_IP || 5), global: Number(env.FREECHECK_GLOBAL || 60) }), now = () => Date.now(), exempt = () => false } = {}) {
    const monitoring = monitoringEnabled(env);
    let coiCache = null; let coiAt = 0; let lookups;
    const getCoi = async () => { if (!coiCache || now() - coiAt > 6 * 3600e3) { coiCache = await loadCoi({ dataDir }).catch(() => null); coiAt = now(); } return coiCache; };
    // Page data for site/analytics.js. The IČO stays out of titles: a sole trader's IČO is personal data.
    const failed = (why) => ({ title: 'Check a Czech supplier by IČO', events: [['Free check', 'free-check-error', why]] });
    return async function handleCheck(req, form, page) {
        if (req.method !== 'POST') return [200, page('Check a Czech supplier by IČO', checkForm())];
        const ico = normaliseIco(form.ico); const web = String(form.web ?? '').trim();
        if (form.fax) return [200, page('Check', checkForm())];
        if (!ico || !isValidIco(ico)) return [400, page('Check a Czech supplier by IČO', checkForm({ ico: form.ico, web, error: 'That is not a valid IČO (8 digits with a checksum). / Neplatné IČO.' }), failed('invalid IČO'))];
        const website = web ? normalizeDomain(web) : null;
        if (web && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(website)) return [400, page('Check a Czech supplier by IČO', checkForm({ ico, web, error: 'That website does not look like a domain, e.g. firma.cz.' }), failed('invalid website'))];
        lookups ??= cachedSources(dataDir, { sources, now, staleFallback: true });
        const isirEnabled = env.ISIR_DISABLED !== '1';
        // Answers already in the cache cost the registers nothing, so they skip the limits.
        if (!lookups.cached(ico, { isir: isirEnabled }) && !exempt(req) && !limiter.allow(clientIp(req))) return [429, page('Too many checks', `<p>Too many checks for now. Please try again in an hour${monitoring ? ', or <a href="/#signup">sign up free</a> to have up to 5 suppliers checked every day' : ''}.</p>`, failed('rate limited'))];
        const coi = website && env.COI_DISABLED !== '1' ? await getCoi() : undefined;
        const { rows } = await check([{ ico, website }], { isirEnabled, coi, sources: lookups });
        const asOf = lookups.asOf(ico, { isir: isirEnabled }); if (asOf) rows[0].checkedAt = new Date(asOf.at).toISOString(); // may be the morning's daily run
        const n = currentAlerts(rows[0]).length;
        return [200, page(`Check result ${ico}`, renderResult(rows[0], { coiUsed: !!website && coi !== undefined, stale: asOf?.stale, monitoring }),
            { title: 'Check result', events: [['Free check', 'free-check', n ? 'warnings' : 'clean', n]] })];
    };
}
