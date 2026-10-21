import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { tmp, listen, mailbox } from './fixtures/helpers.js';

const site = (f) => fs.readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8');

test('home: "What we check" near the top with all five checks, why it matters and source links', () => {
    const h = site('index.html');
    const checks = h.indexOf('id="checks"'); assert.ok(checks > 0 && checks < h.indexOf('id="how"') && checks < h.indexOf('id="pricing"'), 'right after the hero');
    const sec = h.slice(checks, h.indexOf('</section>', checks));
    for (const t of ['Unreliable VAT payer', 'Published bank accounts', 'Insolvency (ISIR)', 'Business register changes (ARES)', 'Risky websites (ČOI)']) assert.ok(sec.includes(t), t);
    for (const u of ['adisspr.mfcr.cz', 'isir.justice.cz', 'ares.gov.cz', 'coi.gov.cz']) assert.ok(sec.includes(u), u);
    assert.match(sec, /statutory body/); assert.match(sec, /§109/);
    assert.match(h, /src="\/sample-alert.png"/); assert.ok(fs.existsSync(new URL('../site/sample-alert.png', import.meta.url)));
});

test('pricing in full Kč including the Accountant plan; no CZK and no personal email anywhere on the site', () => {
    const h = site('index.html');
    for (const p of ['0 Kč', '190 Kč / month', '490 Kč / month', '990 Kč / month', '2,000']) assert.ok(h.includes(p), p);
    const files = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(html|js|xml|txt)$/.test(f)) files.push(p); } };
    walk(new URL('../site', import.meta.url).pathname);
    for (const f of [...files, ...['terms.md', 'privacy.md'].map((x) => new URL(`../legal/${x}`, import.meta.url).pathname)]) {
        const s = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(s, /silverbucket|nick@/i, f); assert.doesNotMatch(s, /\bCZK\b(?! ?Kč)/, f);
    }
});

test('About, Sources and API pages exist, carry the operator details, and are linked from every footer', () => {
    const about = site('about.html');
    for (const s of ['Nicholas Kossow Jennings', 'sole trader', '28948491', 'Maliřska 10, 170 00 Praha 7', 'contact@supplierwatch.cz']) assert.ok(about.includes(s), s);
    const src = site('sources.html');
    for (const s of ['VAT register', 'ARES', 'ISIR', 'ČOI', 'licence-otevrenych-dat', 'Zdroj: Česká obchodní inspekce', '/healthz?detail=1']) assert.ok(src.includes(s), s);
    const api = site('api.html');
    for (const s of ['Authorization: Bearer', '/api/v1/suppliers', '/api/v1/suppliers/{ico}', '/api/v1/alerts?since=', 'next_offset', 'rate_limited', 'revoked_api_key', 'Retry-After']) assert.ok(api.includes(s), s);
    for (const f of ['index.html', 'about.html', 'sources.html', 'api.html', 'guides/index.html']) {
        const footer = site(f).split('<footer')[1]; for (const l of ['/about.html', '/sources.html', '/api.html']) assert.ok(footer.includes(`href="${l}"`), `${f} ${l}`);
    }
    assert.match(site('sitemap.xml'), /about\.html/);
});

test('server serves the new static pages and assets', async () => {
    const srv = createServer({ dataDir: tmp('swpages-'), mailer: mailbox().mailer, log: () => {} }); const url = await listen(srv);
    try {
        for (const p of ['/about.html', '/sources.html', '/api.html', '/csvimport.js', '/sample-alert.png']) assert.equal((await fetch(`${url}${p}`)).status, 200, p);
        assert.equal((await fetch(`${url}/sample-alert.png`)).headers.get('content-type'), 'image/png');
        assert.match(await (await fetch(`${url}/terms.html`)).text(), /990 Kč/);
        assert.match(await (await fetch(`${url}/privacy.html`)).text(), /24 full months/);
    } finally { srv.close(); }
});
