import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createServer } from '../src/server.js';
import { parseAcq, stripeHits, createTracker, analyticsData } from '../src/analytics.js';
import { tmp, listen, post, mailbox, makeAccount, accounts } from './fixtures/helpers.js';

const SECRET = 'whsec_an';
const sign = (b) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${b}`).digest('hex')}`; };
const pageData = (html) => JSON.parse(html.match(/<script type="application\/json" id="sw-a">(.*?)<\/script>/)[1]);

test('parseAcq keeps only a campaign, keyword and an http(s) referrer without query', () => {
    assert.deepEqual(parseAcq(JSON.stringify({ c: 'newsletter', k: 'dph', ref: 'https://www.google.com/search?q=secret' })), { c: 'newsletter', k: 'dph', ref: 'https://www.google.com/search' });
    assert.equal(parseAcq(JSON.stringify({ ref: 'javascript:alert(1)' })), null);
    assert.equal(parseAcq('not json'), null);
    assert.equal(parseAcq(JSON.stringify({ c: 'x'.repeat(2000) })), null);
    assert.equal(parseAcq(''), null);
});

test('analyticsData cannot break out of its script tag', () => {
    assert.doesNotMatch(analyticsData({ title: '</script><script>alert(1)' }), /<\/script><script>/);
    assert.equal(analyticsData({}), '');
});

test('stripeHits: Checkout is a new order with first-touch attribution, renewals are orders, lifecycle is events', () => {
    const a = { id: 'acc_1', plan: 'starter', createdAt: '2026-10-01T00:00:00Z', acq: { c: 'newsletter', ref: 'https://www.google.com/' } };
    let h = stripeHits({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 19000, amount_subtotal: 19000 } } }, a, { plan: 'free' });
    assert.equal(h.length, 2);
    assert.deepEqual({ ...h[0], ec_items: JSON.parse(h[0].ec_items) }, { uid: 'acc_1', idgoal: '0', ec_id: 'cs_1', revenue: '190', ec_items: [['plan-starter', 'Starter', ['Subscription', 'New'], 190, 1]], _rcn: 'newsletter', _ref: 'https://www.google.com/', _refts: String(Date.parse('2026-10-01T00:00:00Z') / 1000), ec_st: '190' });
    assert.deepEqual(h[1], { uid: 'acc_1', e_c: 'Billing', e_a: 'subscription-started', e_n: 'starter', e_v: '190' });

    h = stripeHits({ type: 'invoice.paid', data: { object: { id: 'in_2', billing_reason: 'subscription_cycle', amount_paid: 19000 } } }, a);
    assert.equal(h[0].ec_id, 'in_2'); assert.match(h[0].ec_items, /Renewal/);
    assert.deepEqual(stripeHits({ type: 'invoice.paid', data: { object: { id: 'in_1', billing_reason: 'subscription_create', amount_paid: 19000 } } }, a), [], 'first invoice is the Checkout order');

    const pro = { ...a, plan: 'pro' };
    assert.equal(stripeHits({ type: 'customer.subscription.updated', data: { object: {} } }, pro, { plan: 'starter' })[0].e_a, 'plan-upgraded');
    assert.equal(stripeHits({ type: 'customer.subscription.updated', data: { object: {} } }, { ...a, plan: 'free' }, { plan: 'pro' })[0].e_a, 'subscription-lapsed');
    assert.equal(stripeHits({ type: 'customer.subscription.updated', data: { object: {} } }, { ...pro, cancelAt: 1 }, { plan: 'pro' })[0].e_a, 'cancel-scheduled');
    assert.deepEqual(stripeHits({ type: 'customer.subscription.deleted', data: { object: {} } }, { ...a, plan: 'free' }, { plan: 'pro' }).map((x) => [x.e_a, x.e_n]), [['subscription-cancelled', 'pro']]);
});

test('createTracker is off without MATOMO_URL and never throws', async () => {
    const calls = [];
    const fetchFn = async (u, o) => { calls.push([u, Object.fromEntries(o.body)]); return { ok: true }; };
    await createTracker({ env: {}, fetchFn }).track([{ uid: 'x' }]);
    assert.equal(calls.length, 0);
    await createTracker({ env: { MATOMO_URL: 'https://m.test/', MATOMO_SITE_ID: '9' }, fetchFn, baseUrl: 'https://sw.test' }).track([{ uid: 'acc_1', e_c: 'Billing', e_a: 'x' }]);
    assert.equal(calls[0][0], 'https://m.test/matomo.php');
    assert.equal(calls[0][1].idsite, '9'); assert.equal(calls[0][1].uid, 'acc_1'); assert.equal(calls[0][1].rec, '1');
    await createTracker({ env: { MATOMO_URL: 'https://m.test' }, fetchFn: async () => { throw new Error('down'); } }).track([{ uid: 'x' }]);
});

test('server: sign-up stores first touch, pages carry analytics data, upgrade links are carts, webhook tracks revenue', async () => {
    const dataDir = tmp('swan-'); const { sent, mailer } = mailbox(); const hits = [];
    const srv = createServer({ dataDir, secret: SECRET, baseUrl: 'https://sw.test', mailer, log: () => {}, tracker: { track: async (h) => { hits.push(...h); } } });
    const url = await listen(srv);
    try {
        let r = await post(`${url}/signup`, { email: 'a@firma.cz', consent: 'yes', icos: '27082440', acq: JSON.stringify({ c: 'linkedin' }) });
        let d = pageData(await r.text());
        const a = accounts(dataDir).byEmail('a@firma.cz');
        assert.equal(d.userId, a.id); assert.deepEqual(d.events, [['Signup', 'signup-email-sent', 'within free limit', 1]]);
        assert.deepEqual(a.acq, { c: 'linkedin' });
        await post(`${url}/signup`, { email: 'a@firma.cz', consent: 'yes', icos: '27082440', acq: JSON.stringify({ c: 'other' }) });
        assert.deepEqual(accounts(dataDir).byEmail('a@firma.cz').acq, { c: 'linkedin' }, 'first touch is kept');
        assert.match(sent[0].text, /confirm\?t=[\w-]+&mtm_campaign=confirm-email/);

        const ct = sent[0].text.match(/confirm\?t=([\w-]+)/)[1];
        const html = await (await post(`${url}/confirm`, { t: ct })).text();
        d = pageData(html);
        assert.equal(d.userId, a.id); assert.equal(d.plansView, true); assert.equal(d.events[0][1], 'signup-confirmed');
        assert.match(html, /class="cta matomo_ignore" href="[^"]+" data-plan="starter" data-plan-name="Starter" data-price="190"/);
        assert.match(html, /<script src="\/analytics.js" defer><\/script>/);

        const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_9', client_reference_id: a.id, customer: 'cus_9', subscription: 'sub_9', amount_total: 49000, metadata: { plan: 'pro' } } } });
        assert.equal((await post(`${url}/stripe/webhook`, ev, { 'stripe-signature': sign(ev) })).status, 200);
        assert.equal(hits[0].ec_id, 'cs_9'); assert.equal(hits[0].revenue, '490'); assert.equal(hits[0]._rcn, 'linkedin'); assert.equal(hits[0].uid, a.id);
        const inv = JSON.stringify({ type: 'invoice.paid', data: { object: { id: 'in_9', customer: 'cus_9', billing_reason: 'subscription_cycle', amount_paid: 49000 } } });
        await post(`${url}/stripe/webhook`, inv, { 'stripe-signature': sign(inv) });
        assert.equal(hits.at(-1).ec_id, 'in_9');
        const other = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_9' } } });
        const n = hits.length; await post(`${url}/stripe/webhook`, other, { 'stripe-signature': sign(other) });
        assert.equal(hits.length, n, 'an event the store rejected is not tracked');

        d = pageData(await (await post(`${url}/manage-link?freecheck=1`, { ico: '12345678' })).text());
        assert.deepEqual(d.events, [['Free check', 'free-check-error', 'invalid IČO']]);
        d = pageData(await (await fetch(`${url}/nope`)).text()); assert.equal(d.notFound, true);
    } finally { srv.close(); }
});

test('every static page loads analytics.js', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(`${d}/${f.name}`) : f.name.endsWith('.html') ? [`${d}/${f.name}`] : []));
    for (const f of walk(new URL('../site', import.meta.url).pathname)) assert.match(fs.readFileSync(f, 'utf8'), /<script src="\/analytics.js" defer><\/script>/, f);
});

/** Run site/analytics.js against a fake page and return what it queued for Matomo. */
function runTracker({ href, referrer = '', data = null, forms = [] }) {
    const listeners = {};
    const document = {
        referrer, head: { appendChild() {} }, createElement: () => ({}),
        getElementById: (id) => (id === 'sw-a' && data ? { textContent: JSON.stringify(data) } : null),
        querySelectorAll: (sel) => (sel === 'form[action="/signup"]' ? forms : []),
        addEventListener: (t, fn) => { listeners[t] = fn; },
    };
    const window = {};
    vm.runInNewContext(fs.readFileSync(new URL('../site/analytics.js', import.meta.url), 'utf8'), { window, document, location: new URL(href), URL, URLSearchParams });
    return window._paq;
}

test('analytics.js: tokens never reach Matomo; campaigns and the user id do', () => {
    const q = runTracker({ href: 'https://supplierwatch.cz/manage?t=SECRET&report=2026-09&mtm_campaign=alert-email', referrer: 'https://supplierwatch.cz/confirm?t=SECRET2', data: { userId: 'acc_1', events: [['Signup', 'signup-confirmed', 'free', 1]] } });
    const get = (m) => q.find((x) => x[0] === m);
    assert.equal(get('setCustomUrl')[1], 'https://supplierwatch.cz/manage?mtm_campaign=alert-email');
    assert.equal(get('setReferrerUrl')[1], 'https://supplierwatch.cz/confirm');
    assert.equal(get('setUserId')[1], 'acc_1');
    assert.ok(get('disableCookies'));
    assert.equal(JSON.stringify(get('trackEvent')), JSON.stringify(['trackEvent', 'Signup', 'signup-confirmed', 'free', 1]));
    assert.ok(q.findIndex((x) => x[0] === 'trackPageView') < q.findIndex((x) => x[0] === 'trackEvent'));
    assert.doesNotMatch(JSON.stringify(q), /SECRET/);
});

test('analytics.js: the sign-up form gets the first-touch campaign and external referrer', () => {
    const added = []; const form = { appendChild: (i) => added.push(i) };
    runTracker({ href: 'https://supplierwatch.cz/?utm_campaign=fb&utm_term=dph', referrer: 'https://www.facebook.com/x?fbclid=1', forms: [form] });
    assert.deepEqual(JSON.parse(added[0].value), { c: 'fb', k: 'dph', ref: 'https://www.facebook.com/x' });
    const none = []; runTracker({ href: 'https://supplierwatch.cz/', referrer: 'https://supplierwatch.cz/guides/', forms: [{ appendChild: (i) => none.push(i) }] });
    assert.equal(none.length, 0, 'internal navigation is not a source');
});
