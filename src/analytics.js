// Analytics. Browser side: site/analytics.js (Matomo, cookieless). Server side (here): what the browser never sees,
// i.e. Stripe payments and subscription changes, sent from the webhook to the Matomo HTTP Tracking API with the
// account id as User ID, so revenue joins the visitor who signed up. Off unless MATOMO_URL is set.
import { PLAN_INFO } from './plans.js';

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
    const order = (id, cents, kind, extra = {}) => {
        const price = Math.round(cents) / 100;
        hits.push({ uid, idgoal: '0', ec_id: id, revenue: String(price), ec_items: JSON.stringify([item(a.plan, kind, price)]), ...attribution(a), ...extra });
    };
    if (ev.type === 'checkout.session.completed') {
        const cents = o.amount_total ?? (PLAN_INFO[a.plan]?.priceKc ?? 0) * 100;
        const discount = o.total_details?.amount_discount;
        order(o.id ?? `cs_${uid}_${Date.now()}`, cents, 'New', { ...(o.amount_subtotal != null ? { ec_st: String(o.amount_subtotal / 100) } : {}), ...(discount ? { ec_dt: String(discount / 100) } : {}) });
        event('subscription-started', a.plan, cents / 100);
    } else if (ev.type === 'invoice.paid' || ev.type === 'invoice.payment_succeeded') {
        // The first invoice is already counted as the Checkout order.
        const kind = { subscription_cycle: 'Renewal', subscription_update: 'Plan change' }[o.billing_reason];
        if (kind && o.amount_paid > 0 && o.id) order(o.id, o.amount_paid, kind);
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

/** Matomo HTTP Tracking API client. Never throws: analytics must not break a webhook. */
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
    return { enabled: Boolean(url), track: (hits) => Promise.all(hits.map(send)) };
}
