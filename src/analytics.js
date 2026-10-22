// Analytics. Browser side: site/analytics.js (Matomo, cookieless). Server side (here): what the browser never sees,
// i.e. Stripe payments and subscription changes, sent from the webhook to the Matomo HTTP Tracking API with the
// account id as User ID, so revenue joins the visitor who signed up. Off unless MATOMO_URL is set.
import { PLAN_INFO, PLAN_BY_AMOUNT } from './plans.js';

const RANK = { free: 0, starter: 1, pro: 2, accountant: 3 };

/** Page data for site/analytics.js, embedded in a server-rendered page. Safe inside <script>. */
export const analyticsData = (d) => (d && Object.keys(d).length ? `<script type="application/json" id="sw-a">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>` : '');
export const ANALYTICS_SCRIPT = '<script src="/analytics.js" defer></script>';

/** The first-touch referrer and campaign the sign-up form sends (hidden field "acq"), validated; null if none. */
export function parseAcq(s) {
    if (!s || String(s).length > 1000) return null;
    let j; try { j = JSON.parse(s); } catch { return null; }
    if (!j || typeof j !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    const out = {};
    const c = str(j.c, 100); const k = str(j.k, 100); let ref = str(j.ref, 300);
    if (ref) { try { const u = new URL(ref); ref = /^https?:$/.test(u.protocol) ? u.origin + u.pathname : null; } catch { ref = null; } }
    if (c) out.c = c; if (k) out.k = k; if (ref) out.ref = ref;
    return Object.keys(out).length ? out : null;
}

/**
 * A Matomo visit (Live API) -> first touch { c, k } for a campaign, { ref } for a search engine, website or social
 * network, null for a direct visit. Same shape as parseAcq.
 */
export function visitToAcq(v) {
    if (!v || !v.referrerType || v.referrerType === 'direct') return null;
    if (v.referrerType === 'campaign') return v.referrerName ? { c: String(v.referrerName).slice(0, 100), ...(v.referrerKeyword ? { k: String(v.referrerKeyword).slice(0, 100) } : {}) } : null;
    const ref = parseAcq(JSON.stringify({ ref: v.referrerUrl || (v.referrerName && /^[\w.-]+\.[a-z]{2,}$/i.test(v.referrerName) ? `https://${v.referrerName}/` : null) }));
    return ref;
}

/**
 * The plan an invoice paid for, from its own lines: webhooks arrive in any order, so the account's plan may not
 * yet (or no longer) be the invoiced one. Charge lines only (prorations credit the old plan with negative lines).
 */
export function invoicePlan(o) {
    const known = (p) => (p && PLAN_INFO[p] && p !== 'free' ? p : null);
    for (const l of (o.lines?.data ?? []).filter((x) => x.amount > 0)) {
        const price = typeof l.price === 'object' ? l.price : null;
        // Line metadata last: it is inherited from the subscription, which keeps its checkout plan after a portal switch.
        const p = known(price?.metadata?.plan) ?? known(PLAN_BY_AMOUNT[price?.unit_amount ?? l.plan?.amount]) ?? known(l.metadata?.plan);
        if (p) return p;
    }
    return o.billing_reason === 'subscription_cycle' ? known(PLAN_BY_AMOUNT[o.amount_paid]) : null;
}

const item = (plan, kind, price) => [`plan-${plan}`, PLAN_INFO[plan]?.name ?? plan, ['Subscription', kind], price, 1];
const attribution = (a) => ({
    ...(a.acq?.c ? { _rcn: a.acq.c } : {}), ...(a.acq?.k ? { _rck: a.acq.k } : {}), ...(a.acq?.ref ? { _ref: a.acq.ref } : {}),
    ...(a.createdAt ? { _refts: String(Math.floor(Date.parse(a.createdAt) / 1000)) } : {}),
});

/**
 * Tracking requests for a Stripe event the account store accepted. `a` is the account after the event, `before`
 * its { plan, cancelAt } before. Orders use the Stripe object id, so a retried webhook does not count twice.
 */
export function stripeHits(ev, a, before = {}) {
    const o = ev.data?.object ?? {}; const uid = a.id; const hits = [];
    const event = (action, name, value) => hits.push({ uid, e_c: 'Billing', e_a: action, ...(name ? { e_n: name } : {}), ...(value != null ? { e_v: String(value) } : {}) });
    const order = (id, cents, kind, extra = {}, plan = a.plan) => {
        const price = Math.round(cents) / 100;
        hits.push({ uid, idgoal: '0', ec_id: id, revenue: String(price), ec_items: JSON.stringify([item(plan, kind, price)]), ...attribution(a), ...extra });
    };
    if (ev.type === 'checkout.session.completed') {
        const cents = o.amount_total ?? (PLAN_INFO[a.plan]?.priceKc ?? 0) * 100;
        const discount = o.total_details?.amount_discount;
        order(o.id ?? `cs_${uid}_${Date.now()}`, cents, 'New', { ...(o.amount_subtotal != null ? { ec_st: String(o.amount_subtotal / 100) } : {}), ...(discount ? { ec_dt: String(discount / 100) } : {}) });
        event('subscription-started', a.plan, cents / 100);
    } else if (ev.type === 'invoice.paid' || ev.type === 'invoice.payment_succeeded') {
        // The first invoice is already counted as the Checkout order.
        const kind = { subscription_cycle: 'Renewal', subscription_update: 'Plan change' }[o.billing_reason];
        if (kind && o.amount_paid > 0 && o.id) order(o.id, o.amount_paid, kind, {}, invoicePlan(o) ?? a.plan);
    } else if (ev.type === 'customer.subscription.updated') {
        if (before.plan !== a.plan) {
            const dir = a.plan === 'free' ? 'subscription-lapsed' : (RANK[a.plan] ?? 0) > (RANK[before.plan] ?? 0) ? 'plan-upgraded' : 'plan-downgraded';
            event(dir, `${before.plan ?? '?'} -> ${a.plan}`);
        }
        if (a.cancelAt && !before.cancelAt) event('cancel-scheduled', a.plan);
        if (!a.cancelAt && before.cancelAt && a.plan !== 'free') event('cancel-reverted', a.plan);
    } else if (ev.type === 'customer.subscription.deleted') {
        if (before.plan && before.plan !== 'free') event('subscription-cancelled', before.plan);
    }
    return hits;
}

/**
 * Matomo client: tracking (HTTP Tracking API) and the first-touch lookup (Live API, needs MATOMO_TOKEN with view
 * access). Never throws: analytics must not break a webhook.
 */
export function createTracker({ env = process.env, baseUrl = 'https://supplierwatch.cz', fetchFn = fetch, log = () => {}, version = '' } = {}) {
    const url = env.MATOMO_URL ? env.MATOMO_URL.replace(/\/$/, '') : null;
    const idsite = env.MATOMO_SITE_ID || '9';
    const send = async (params) => {
        if (!url) return;
        const body = new URLSearchParams({
            idsite, rec: '1', apiv: '1', send_image: '0', rand: String(Math.random()).slice(2),
            url: `${baseUrl}/stripe/webhook`,
            // A browser-like UA: Matomo drops requests whose user agent looks like a bot.
            ua: `Mozilla/5.0 (X11; Linux x86_64) SupplierWatch/${version}`, ...params,
        });
        try {
            const r = await fetchFn(`${url}/matomo.php`, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
            if (!r.ok) log(`matomo: HTTP ${r.status}`);
        } catch (e) { log(`matomo: ${e.message}`); }
    };
    /**
     * Where the account's first visit came from. The page after sign-up sets the User ID on the visit it happened in,
     * and Matomo joins a visit's pages without cookies, so the earliest visit with this User ID has the referrer of the
     * page the person landed on (a guide, say), not of the sign-up page. Returns undefined when unknown (no token,
     * Matomo unreachable, no browser visit yet), so the caller can ask again next time.
     */
    const firstTouch = async (uid) => {
        if (!url || !env.MATOMO_TOKEN) return undefined;
        const body = new URLSearchParams({ module: 'API', method: 'Live.getLastVisitsDetails', format: 'JSON', idSite: idsite, segment: `userId==${uid}`,
            filter_limit: '5', filter_sort_order: 'asc', token_auth: env.MATOMO_TOKEN });
        try {
            const r = await fetchFn(`${url}/index.php`, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
            const j = await r.json();
            if (!r.ok || !Array.isArray(j)) { log(`matomo live: ${j?.message ?? `HTTP ${r.status}`}`); return undefined; }
            // Browser visits only: our own webhook hits (events and orders, never page views) make visits with this
            // User ID too, which look direct. None yet (tracking blocked, say) is unknown, not direct.
            const v = j.find((x) => (x.actionDetails ?? []).some((d) => d.type === 'action'));
            return v ? visitToAcq(v) : undefined;
        } catch (e) { log(`matomo live: ${e.message}`); return undefined; }
    };
    return { enabled: Boolean(url), track: (hits) => Promise.all(hits.map(send)), firstTouch };
}
