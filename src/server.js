#!/usr/bin/env node
// Supplier Watch web app. Listens on 127.0.0.1 behind the web server and serves:
//   static site, /terms.html, /privacy.html, POST /signup, GET /confirm, POST /manage-link,
//   GET+POST /check (free one-off check), GET+POST /manage, GET+POST /unsubscribe, POST /stripe/webhook, GET /healthz
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySignature } from './billing.js';
import { Accounts, PLANS, parseSupplierForm, validEmail, normEmail, suppliersText } from './accounts.js';
import { createMailer } from './mailer.js';
import { createFreeCheck, checkPageHtml } from './freecheck.js';
import { createApi } from './api.js';
import { PLAN_INFO } from './plans.js';
import { historyMonths, validMonth } from './history.js';
import { getReport, monthLabel } from './monthly.js';
import { readStatus } from './canary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } })();
export const ACCOUNTANT_TEST_LINK = 'https://buy.stripe.com/test_14AdR92KNeiL730fys1ZS02';
export const CONSENT_TEXT = 'I agree to the Terms and the Privacy Policy and consent to receiving supplier alert emails. / Souhlasím s Podmínkami a Zásadami ochrany osobních údajů a se zasíláním upozornění e-mailem.';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">${title.startsWith('Check a Czech') ? '<meta name="description" content="Free check of a Czech company by IČO: unreliable VAT payer status, published bank accounts, insolvency (ISIR), ARES and the ČOI risky e-shop list. No account needed."><link rel="canonical" href="https://supplierwatch.cz/check.html">' : /^(terms|privacy)$/.test(title) ? '' : '<meta name="robots" content="noindex">'}<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - Supplier Watch CZ</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}textarea{width:100%}.sw-row{display:flex;gap:.5rem;margin:.3rem 0}.sw-row input{flex:1;padding:.3rem}.sw-bad{border-color:#c00!important;background:#fff4f4}.sw-err{color:#c00;font-size:.9em}.muted{color:#666}.sw-row input{min-width:0}.cta{display:inline-block;padding:.4rem .9rem;background:#0b5;color:#fff;border-radius:4px;text-decoration:none;margin:.2rem}table.t{border-collapse:collapse;width:100%;font-size:.92em}table.t td,table.t th{border-bottom:1px solid #ddd;padding:.3rem .4rem;text-align:left;vertical-align:top}.box{background:#f6f8fa;border-radius:8px;padding:.6rem 1rem;margin:1rem 0}code{background:#f1f3f5;padding:.1rem .3rem;border-radius:3px;word-break:break-all}</style></head><body><p><a href="/">Supplier Watch CZ</a></p>${body}</body></html>`;
const row = (ico = '', web = '') => `<div class="sw-row"><input name="ico" inputmode="numeric" maxlength="10" placeholder="IČO (8 digits)" aria-label="IČO" value="${esc(ico)}"><input name="web" placeholder="website (optional), e.g. firma.cz" aria-label="Website (optional)" value="${esc(web)}"><button type="button" class="sw-del" aria-label="Remove">×</button></div>`;
/** Structured supplier rows (enhanced by /suppliers.js) with a collapsible paste box. Works without JS. */
export function supplierFields(icos = [], websites = {}, limit = 5) {
    const rows = icos.map((i) => row(i, websites?.[i] ?? ''));
    const blanks = Math.max(icos.length ? 1 : 3, 0); for (let k = 0; k < blanks && rows.length < limit; k++) rows.push(row());
    return `<div class="sw-sup" data-limit="${Number(limit)}"><p><strong>Suppliers / Dodavatelé</strong> (up to ${Number(limit)}): IČO and, optionally, the supplier's website</p>
<div class="sw-rows">${rows.join('')}</div><p class="sw-err" role="alert"></p>
<button type="button" class="sw-add">+ Add supplier / Přidat dodavatele</button> <span class="sw-count muted"></span>
<p class="muted"><label>Import CSV / Nahrát CSV: <input type="file" class="sw-file" accept=".csv,.txt,text/csv"></label> Pohoda, Money S3, Fakturoid or any CSV with an IČO column. <span class="sw-csvinfo" role="status"></span></p>
<details class="sw-paste"><summary>Paste a list instead / Vložit seznam</summary><textarea name="icos" rows="6" placeholder="27082440 firma.cz&#10;45274649"></textarea><br><button type="button" class="sw-parse">Add to rows / Přidat do řádků</button> <span class="muted">One IČO per line, optionally followed by the website, or a whole CSV export with its header row.</span></details></div>`;
}
function mdToHtml(md) { // tiny renderer, enough for the legal drafts
    return md.split(/\n{2,}/).map((b) => { const h = b.match(/^(#{1,3}) (.*)/); if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`; return `<p>${esc(b).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`; }).join('\n');
}

export function createServer({
    env = process.env, dataDir = env.DATA_DIR || 'data', secret = env.STRIPE_WEBHOOK_SECRET,
    baseUrl = (env.BASE_URL || 'https://supplierwatch.cz').replace(/\/$/, ''), mailer = createMailer(env), log = console.log, now = () => Date.now(), freeCheck, stripePortal,
} = {}) {
    const handleCheck = freeCheck ?? createFreeCheck({ env, dataDir });
    const accFile = path.join(dataDir, 'accounts.json');
    const links = { starter: env.STRIPE_LINK_STARTER || 'https://buy.stripe.com/test_3cIdR9dpr1vZ5YWbic1ZS00', pro: env.STRIPE_LINK_PRO || 'https://buy.stripe.com/test_bJe28rdprb6z0ECdqk1ZS01', accountant: env.STRIPE_LINK_ACCOUNTANT || ACCOUNTANT_TEST_LINK };
    const handleApi = createApi({ dataDir, env, now, log });
    const stripeKey = env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY;
    const canBill = (a) => Boolean(stripeKey && a.stripeCustomer && a.plan !== 'free');
    const billingBtn = (a, t) => (canBill(a) ? `<form method="post" action="/manage"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="action" value="billing"><button>Manage billing / cancel · Správa plateb / zrušení</button></form>${a.cancelAt ? `<p><strong>Your plan is set to end on ${esc(new Date(a.cancelAt * 1000).toISOString().slice(0, 10))}, then moves to free. / Tarif skončí ${esc(new Date(a.cancelAt * 1000).toISOString().slice(0, 10))}.</strong></p>` : ''}` : '');
    const portal = stripePortal ?? (async (customer, returnUrl) => {
        const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', { method: 'POST', headers: { authorization: `Bearer ${stripeKey}`, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ customer, return_url: returnUrl, ...(env.STRIPE_PORTAL_CONFIG ? { configuration: env.STRIPE_PORTAL_CONFIG } : {}) }) });
        const j = await r.json(); if (!r.ok || !j.url) throw new Error(j.error?.message ?? `stripe ${r.status}`); return j.url;
    });
    const lastMail = new Map(); // email -> ms, simple anti-abuse cooldown
    const cooldown = (kind, email) => { const k = `${kind}:${email}`; const t = lastMail.get(k); if (t && now() - t < 60e3) return true; lastMail.set(k, now()); return false; };
    const unsubUrl = (a) => `${baseUrl}/unsubscribe?t=${a.unsubToken}`;
    const checkoutUrl = (a, plan) => `${links[plan]}?client_reference_id=${encodeURIComponent(a.id)}&prefilled_email=${encodeURIComponent(a.email)}`;
    const SCRIPTS = '<script src="/csvimport.js"></script><script src="/suppliers.js"></script>';
    const hidden = (t, extra = {}) => `<input type="hidden" name="t" value="${esc(t)}">${Object.entries(extra).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}`;
    const mlink = (t, params = {}) => `/manage?${new URLSearchParams({ t, ...params })}`;
    const upgradeHtml = (a) => {
        const opts = ['starter', 'pro', 'accountant'].filter((p) => PLAN_INFO[p].limit > PLAN_INFO[a.plan].limit && links[p]);
        if (!opts.length) return '';
        const label = { starter: 'Starter: 50 suppliers, 190 Kč / month', pro: 'Pro: 500 suppliers + API, 490 Kč / month', accountant: 'Accountant: 2,000 suppliers, client lists + API, 990 Kč / month' };
        return `<h2>Upgrade</h2><p>${opts.map((p) => `<a class="cta" href="${esc(checkoutUrl(a, p))}">${label[p]}</a>`).join(' ')}</p>`;
    };
    const reportsHtml = (a, t, clientId = null) => {
        const months = historyMonths(dataDir, a.id).slice(0, 24);
        if (!months.length) return '<h2>Monthly reports / Měsíční protokoly</h2><p class="muted">Your first PDF report appears here after the first daily check. The report for each month is also emailed to you on the 1st of the next month.</p>';
        return `<h2>Monthly reports / Měsíční protokoly</h2><p>PDF with every check we ran in the month${clientId ? ' for this client' : ''}, per supplier, with results and times. The current month is a report so far.</p><ul>${months.map((m) => `<li><a href="${esc(mlink(t, { report: m, ...(clientId ? { client: clientId } : {}) }))}">${esc(monthLabel(m))} (PDF)</a></li>`).join('')}</ul>`;
    };
    const keysHtml = (a, t, newKey = null) => {
        if (!PLAN_INFO[a.plan]?.api) return `<h2>API</h2><p class="muted">A read-only JSON API is included with Pro and Accountant. <a href="/api.html">API documentation</a></p>`;
        const keys = (a.apiKeys ?? []).slice().reverse();
        return `<h2>API keys</h2>${newKey ? `<div class="box"><p><strong>New API key, shown only once. Copy it now:</strong></p><p><code>${esc(newKey)}</code></p><p class="muted">We store only a hash of it. If you lose it, revoke it and create a new one.</p></div>` : ''}
<p>Use a key as <code>Authorization: Bearer &lt;key&gt;</code>. See the <a href="/api.html">API documentation</a>.</p>
${keys.length ? `<table class="t"><tr><th>Key</th><th>Label</th><th>Created</th><th>Last used</th><th></th></tr>${keys.map((k) => `<tr><td><code>${esc(k.prefix)}…</code></td><td>${esc(k.label)}</td><td>${esc(k.createdAt.slice(0, 10))}</td><td>${esc(k.lastUsedAt?.slice(0, 10) ?? '-')}</td><td>${k.revokedAt ? `revoked ${esc(k.revokedAt.slice(0, 10))}` : `<form method="post" action="/manage">${hidden(t, { action: 'revoke_key', key: k.id })}<button>Revoke</button></form>`}</td></tr>`).join('')}</table>` : ''}
<form method="post" action="/manage">${hidden(t, { action: 'create_key' })}<input name="label" maxlength="60" placeholder="label, e.g. ERP sync"> <button>Create API key</button></form>`;
    };
    const clientsHtml = (acc, a, t) => {
        if (!acc.hasClients(a)) return (a.clients ?? []).length ? `<p class="muted">You have ${a.clients.length} client lists, paused because they need the Accountant plan.</p>` : '';
        const cl = a.clients ?? [];
        return `<h2>Clients / Klienti</h2><p>Each client has its own supplier list, optional alert recipients and monthly report. The ${acc.limit(a).toLocaleString('en-US')} supplier limit is shared across all lists.</p>
${cl.length ? `<table class="t"><tr><th>Client</th><th>Suppliers</th><th>Extra recipients</th></tr>${cl.map((c) => `<tr><td><a href="${esc(mlink(t, { client: c.id }))}">${esc(c.name)}</a></td><td>${c.icos.length}</td><td>${(c.recipients ?? []).map((r) => esc(r.email) + (r.unsubscribed ? ' (unsubscribed)' : '')).join(', ') || '-'}</td></tr>`).join('')}</table>` : '<p class="muted">No clients yet.</p>'}
<form method="post" action="/manage">${hidden(t, { action: 'add_client' })}<input name="name" maxlength="120" required placeholder="client name, e.g. Novák s.r.o."> <button>Add client</button></form>`;
    };
    const manageHtml = (acc, a, t, note = '', { newKey } = {}) => {
        const used = acc.total(a); const lim = acc.limit(a);
        const room = Math.max(a.icos.length, lim - acc.total(a, 'main'));
        return page('Your suppliers', `<h1>Your suppliers / Vaši dodavatelé</h1>${note}
<p>${esc(a.email)} · plan <strong>${esc(PLAN_INFO[a.plan]?.name ?? a.plan)}</strong> · ${used} of ${lim.toLocaleString('en-US')} suppliers used${a.unsubscribed ? ' · <strong>alerts paused (unsubscribed)</strong>' : ''}</p>
${acc.hasClients(a) ? '<h2>Your own suppliers</h2>' : ''}<form method="post" action="/manage">${hidden(t)}
${supplierFields(a.icos, a.websites, room)}
${a.unsubscribed ? '<label><input type="checkbox" name="resubscribe" value="1"> Resume alert emails / Obnovit zasílání</label><br>' : ''}
<button>Save / Uložit</button></form>${SCRIPTS}
${clientsHtml(acc, a, t)}
${reportsHtml(a, t)}
${keysHtml(a, t, newKey)}
${upgradeHtml(a)}
${billingBtn(a, t)}<p class="muted">You can cancel anytime from your manage page (the link is in every email) using the Manage billing button. Your plan stays active until the end of the paid month, then moves to the free plan.<br>Tarif můžete kdykoli zrušit na stránce správy účtu (odkaz najdete v každém e-mailu) tlačítkem Správa plateb. Tarif zůstane aktivní do konce zaplaceného měsíce, poté přejde na bezplatný.</p>`);
    };
    const clientHtml = (acc, a, c, t, note = '') => {
        const room = Math.max(c.icos.length, acc.limit(a) - acc.total(a, c.id));
        return page(`Client ${c.name}`, `<p><a href="${esc(mlink(t))}">&larr; All lists</a></p><h1>${esc(c.name)}</h1>${note}
<form method="post" action="/manage">${hidden(t, { action: 'save_client', client: c.id })}
<p><label>Client name <input name="name" maxlength="120" value="${esc(c.name)}" required></label></p>
${supplierFields(c.icos, c.websites, room)}
<p><label>Extra alert recipients for this client (optional, up to 5, comma separated). They get this client's alerts and monthly report, each with their own unsubscribe link:<br><textarea name="recipients" rows="2">${esc((c.recipients ?? []).map((r) => r.email).join(', '))}</textarea></label></p>
<button>Save / Uložit</button></form>${SCRIPTS}
${reportsHtml(a, t, c.id)}
<h2>Delete client</h2><form method="post" action="/manage" onsubmit="return confirm('Delete this client and its supplier list?')">${hidden(t, { action: 'delete_client', client: c.id })}<button>Delete ${esc(c.name)}</button></form>`);
    };

    async function handle(req, res, body) {
        const url = new URL(req.url, 'http://x');
        const send = (code, html, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(html); };
        const form = () => Object.fromEntries(new URLSearchParams(body));
        const P = url.pathname;
        if (req.method === 'GET' && P === '/healthz') {
            if (!url.searchParams.has('detail')) return send(200, '{"ok":true}', 'application/json');
            const st = readStatus(dataDir);
            return send(200, JSON.stringify({ ok: true, version: VERSION, sources: st ? { checkedAt: st.checkedAt, ok: st.ok, failed: st.failed, detail: st.sources } : null }), 'application/json');
        }
        if (P === '/api' || P.startsWith('/api/')) {
            const r = await handleApi(req, url);
            res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...r.headers });
            return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(r.body));
        }

        // /check.html is static (nginx); its form posts to /manage-link?freecheck=1 because that path is already proxied.
        if (P === '/check' || (req.method === 'POST' && P === '/manage-link' && url.searchParams.get('freecheck') === '1')) { const [code, html] = await handleCheck(req, form(), page); return send(code, html); }

        if (req.method === 'POST' && P === '/stripe/webhook') {
            if (!verifySignature(body, req.headers['stripe-signature'], secret)) return send(400, '{"error":"bad signature"}', 'application/json');
            let ev; try { ev = JSON.parse(body); } catch { return send(400, '{"error":"bad json"}', 'application/json'); }
            const acc = new Accounts(accFile, { now }); const r = acc.applyStripe(ev);
            if (r) { acc.save(); log(`stripe ${ev.type}: ${r}`); } else if (ev.type === 'checkout.session.completed') log(`stripe checkout for unknown account ${ev.data?.object?.client_reference_id ?? ''}`);
            return send(200, '{"received":true}', 'application/json');
        }

        if (req.method === 'POST' && P === '/signup') {
            const f = form(); const email = normEmail(f.email);
            if (!validEmail(email)) return send(400, page('Error', '<p>Please enter a valid email. / Zadejte platný e-mail.</p><p><a href="/#signup">Back</a></p>'));
            if (f.consent !== 'yes') return send(400, page('Error', '<p>Please tick the consent box. / Zaškrtněte prosím souhlas.</p><p><a href="/#signup">Back</a></p>'));
            if (f.fax) return send(200, page('Check your email', '<p>Check your email.</p>')); // honeypot
            const { icos, websites, invalid } = parseSupplierForm(new URLSearchParams(body));
            if (!icos.length) return send(400, page('Error', `<p>No valid IČO found. / Nenalezeno žádné platné IČO.${invalid.length ? ` Invalid: ${esc(invalid.join(', '))}` : ''}</p><p><a href="/#signup">Back</a></p>`));
            const acc = new Accounts(accFile, { now });
            const { account, confirmToken } = acc.signup(email, icos, { consentText: CONSENT_TEXT, websites }); acc.save();
            if (!cooldown("signup", email)) {
                await mailer.send({ to: email, unsubscribeUrl: unsubUrl(account), subject: 'Confirm your Supplier Watch sign-up / Potvrďte registraci',
                    text: `Please confirm your email to start daily supplier checks (link valid 48 hours):\nPotvrďte prosím e-mail pro spuštění denních kontrol (odkaz platí 48 hodin):\n\n${baseUrl}/confirm?t=${confirmToken}\n\nYou can cancel anytime from your manage page (the link is in every email) using the Manage billing button. Your plan stays active until the end of the paid month, then moves to the free plan.\nTarif můžete kdykoli zrušit na stránce správy účtu (odkaz najdete v každém e-mailu) tlačítkem Správa plateb. Tarif zůstane aktivní do konce zaplaceného měsíce, poté přejde na bezplatný.\n\nIf you did not sign up, ignore this email. / Pokud jste se neregistrovali, e-mail ignorujte.` });
            }
            const capped = icos.length > PLANS.free ? `<p>The free plan covers ${PLANS.free} suppliers; the first ${PLANS.free} were kept. You can upgrade after confirming.</p>` : '';
            return send(200, page('Check your email', `<h1>Check your email / Zkontrolujte e-mail</h1><p>We sent a confirmation link to ${esc(email)}.</p>${capped}${invalid.length ? `<p>Ignored invalid IČO: ${esc(invalid.join(', '))}</p>` : ''}`));
        }

        if (req.method === 'GET' && P === '/confirm') {
            const acc = new Accounts(accFile, { now }); const a = acc.confirm(url.searchParams.get('t'));
            if (!a) return send(400, page('Link expired', '<p>This link is invalid or expired. Sign up again on the <a href="/#signup">home page</a>.</p>'));
            const mt = acc.issue(a.id, 'manage'); acc.save();
            return send(200, manageHtml(acc, a, mt, '<p><strong>Email confirmed. Daily checks start tomorrow at 06:30 Prague time. / E-mail potvrzen.</strong></p>'));
        }

        if (req.method === 'POST' && (P === '/billing' || (P === '/manage' && form().action === 'billing'))) { // billing posts to /manage (already proxied by nginx)
            const t = form().t; const acc = new Accounts(accFile, { now }); const a = t && acc.use(t, 'manage');
            if (!a) return send(400, page('Link expired', '<p>This link is invalid or expired. Request a new one from the <a href="/">home page</a>.</p>'));
            if (!canBill(a)) return send(400, page('Billing', '<p>No paid subscription on this account. / Účet nemá placený tarif.</p>'));
            acc.save();
            try { const u = await portal(a.stripeCustomer, `${baseUrl}/manage?t=${encodeURIComponent(t)}`); res.writeHead(303, { location: u }); return res.end(); }
            catch (e) { log(`stripe portal error: ${e.message}`); return send(502, page('Billing', '<p>Billing is temporarily unavailable; please try again later. / Zkuste to prosím později.</p>')); }
        }

        if (req.method === 'POST' && P === '/manage-link') {
            const email = normEmail(form().email); const acc = new Accounts(accFile, { now }); const a = acc.byEmail(email);
            if (a?.confirmed && !cooldown("manage", email)) {
                const t = acc.issue(a.id, 'manage'); acc.save();
                await mailer.send({ to: a.email, unsubscribeUrl: unsubUrl(a), subject: 'Edit your Supplier Watch list / Úprava seznamu', text: `Edit your supplier list (link valid 24 hours):\nÚprava seznamu dodavatelů (platí 24 hodin):\n\n${baseUrl}/manage?t=${t}` });
            }
            return send(200, page('Check your email', '<p>If that address has an account, we sent it a link. / Pokud účet existuje, poslali jsme odkaz.</p>'));
        }

        if (P === '/manage') {
            const f = req.method === 'POST' ? form() : {};
            const t = req.method === 'POST' ? f.t : url.searchParams.get('t');
            const acc = new Accounts(accFile, { now }); const a = t && acc.use(t, 'manage');
            if (!a) return send(400, page('Link expired', '<p>This link is invalid or expired.</p><form method="post" action="/manage-link"><input name="email" type="email" placeholder="email" required> <button>Send a new link</button></form>'));
            if (req.method === 'GET') {
                const rep = url.searchParams.get('report'); const cid = url.searchParams.get('client');
                if (cid && !acc.client(a, cid)) return send(404, page('Not found', '<p>No such client.</p>'));
                if (rep) {
                    if (!validMonth(rep)) return send(400, page('Report', '<p>Invalid month.</p>'));
                    const buf = getReport(dataDir, a, rep, { clientId: cid || null, now: new Date(now()) });
                    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="supplierwatch-report-${rep}${cid ? `-${cid}` : ''}.pdf"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
                    return res.end(buf);
                }
                if (cid) return send(200, clientHtml(acc, a, acc.client(a, cid), t));
                return send(200, manageHtml(acc, a, t));
            }
            const action = f.action || 'save';
            if (action === 'create_key') {
                const r = acc.createApiKey(a, f.label); acc.save();
                return send(r.error ? 400 : 200, manageHtml(acc, a, t, r.error ? `<p class="sw-err">${esc(r.error)}</p>` : '<p><strong>API key created.</strong></p>', { newKey: r.key }));
            }
            if (action === 'revoke_key') { const ok = acc.revokeApiKey(a, f.key); acc.save(); return send(ok ? 200 : 400, manageHtml(acc, a, t, ok ? '<p><strong>API key revoked.</strong></p>' : '<p class="sw-err">Key not found.</p>')); }
            if (action === 'add_client') {
                const r = acc.addClient(a, f.name); if (r.error) return send(400, manageHtml(acc, a, t, `<p class="sw-err">${esc(r.error)}</p>`));
                acc.save(); return send(200, clientHtml(acc, a, r.client, t, '<p><strong>Client added. Now add its suppliers.</strong></p>'));
            }
            if (action === 'delete_client') { const ok = acc.removeClient(a, f.client); acc.save(); return send(ok ? 200 : 404, manageHtml(acc, a, t, ok ? '<p><strong>Client deleted.</strong></p>' : '<p class="sw-err">No such client.</p>')); }
            const { icos, websites, invalid } = parseSupplierForm(new URLSearchParams(body));
            if (action === 'save_client') {
                const c = acc.client(a, f.client); if (!c) return send(404, page('Not found', '<p>No such client.</p>'));
                if (!acc.hasClients(a)) return send(403, manageHtml(acc, a, t, '<p class="sw-err">Client lists need the Accountant plan.</p>'));
                acc.renameClient(a, c.id, f.name);
                const r = acc.setClientIcos(a, c.id, icos, websites); const rr = acc.setClientRecipients(a, c.id, f.recipients); acc.save();
                const note = `<p><strong>Saved ${r.kept} suppliers.</strong>${r.dropped ? ` ${r.dropped} over your plan limit were not saved.` : ''}${invalid.length ? ` Ignored invalid: ${esc(invalid.join(', '))}` : ''}${rr.invalid.length ? ` Ignored invalid emails: ${esc(rr.invalid.join(', '))}` : ''}</p>`;
                return send(200, clientHtml(acc, a, c, t, note));
            }
            const r = acc.setIcos(a, icos, websites);
            if (f.resubscribe === '1') a.unsubscribed = false;
            acc.save();
            const note = `<p><strong>Saved ${r.kept} suppliers.</strong>${r.dropped ? ` ${r.dropped} over your plan limit were not saved; upgrade below.` : ''}${invalid.length ? ` Ignored invalid: ${esc(invalid.join(', '))}` : ''}</p>`;
            return send(200, manageHtml(acc, a, t, note));
        }

        if (P === '/unsubscribe') { // GET shows a button (link scanners must not unsubscribe), POST does it (also RFC 8058 one-click)
            const t = url.searchParams.get('t') || form().t;
            if (req.method === 'GET') return send(200, page('Unsubscribe', `<form method="post" action="/unsubscribe?t=${esc(t)}"><p>Stop all Supplier Watch emails? / Zastavit všechny e-maily?</p><button>Unsubscribe / Odhlásit</button></form>`));
            const acc = new Accounts(accFile, { now }); const a = acc.unsubscribe(t); if (a) acc.save();
            return send(a ? 200 : 400, page('Unsubscribe', a ? '<p>You\'re unsubscribed and won\'t get any more emails. This doesn\'t cancel a paid plan. You can cancel anytime from your manage page (the link is in every email) using the Manage billing button. Your plan stays active until the end of the paid month, then moves to the free plan.</p><p>Odhlášení proběhlo, další e-maily už nedostanete. Placený tarif tím zrušen není. Tarif můžete kdykoli zrušit na stránce správy účtu (odkaz najdete v každém e-mailu) tlačítkem Správa plateb. Tarif zůstane aktivní do konce zaplaceného měsíce, poté přejde na bezplatný.</p>' : '<p>Unknown link.</p>'));
        }

        if (req.method === 'GET' && (P === '/terms.html' || P === '/privacy.html')) {
            return send(200, page(P.slice(1, -5), mdToHtml(fs.readFileSync(path.join(ROOT, 'legal', `${P.slice(1, -5)}.md`), 'utf8'))));
        }
        if (req.method === 'GET') { // static site
            const rel = P === '/' ? 'index.html' : path.normalize(P).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
            let f = path.join(ROOT, 'site', rel);
            if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
            if (f.startsWith(path.join(ROOT, 'site')) && fs.existsSync(f) && fs.statSync(f).isFile()) {
                const types = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
                return send(200, fs.readFileSync(f), types[path.extname(f)] || 'application/octet-stream');
            }
        }
        return send(404, page('Not found', '<p>Not found.</p>'));
    }

    return http.createServer((req, res) => {
        const chunks = []; let size = 0;
        req.on('data', (c) => { size += c.length; if (size > 1e6) req.destroy(); else chunks.push(c); });
        req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8')).catch((e) => { log(`error ${req.method} ${req.url.split('?')[0]}: ${e.message}`); if (!res.headersSent) { res.writeHead(500); res.end('Server error'); } }));
    });
}

export function writeCheckPage(file = path.join(ROOT, 'site', 'check.html')) { fs.writeFileSync(file, checkPageHtml(page)); }

if (process.argv[2] === '--write-check-page') { writeCheckPage(); process.exit(0); }
if (import.meta.url === `file://${process.argv[1]}`) {
    const port = Number(process.env.PORT || 8787);
    if (!process.env.STRIPE_WEBHOOK_SECRET) console.error('warning: STRIPE_WEBHOOK_SECRET not set; all webhooks will be rejected');
    if (!process.env.SMTP_HOST || !process.env.SMTP_PASS) console.error('warning: SMTP_HOST/SMTP_PASS not set; emails are written to DATA_DIR/outbox instead of sent');
    createServer().listen(port, '127.0.0.1', () => console.log(`supplierwatch app on 127.0.0.1:${port}`));
}
