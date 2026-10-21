#!/usr/bin/env node
// One-off, idempotent Matomo site setup for Supplier Watch: funnel goals (matched on the event actions that
// site/analytics.js and src/server.js send) and the query parameters Matomo must never store.
// Usage: MATOMO_URL=https://matomo.example MATOMO_TOKEN=... [MATOMO_SITE_ID=9] node tools/matomo-setup.js
const url = (process.env.MATOMO_URL || '').replace(/\/$/, '');
const token = process.env.MATOMO_TOKEN;
const idSite = process.env.MATOMO_SITE_ID || '9';
if (!url || !token) { console.error('Set MATOMO_URL and MATOMO_TOKEN (a token with admin access to the site).'); process.exit(1); }

// [name, event action, description]. Revenue comes from ecommerce orders (Stripe webhook), not from goals.
const GOALS = [
    ['Free IČO check', 'free-check', 'Ran the free one-off check (result page shown)'],
    ['Sign-up submitted', 'signup-submit', 'Submitted the sign-up form'],
    ['Sign-up email sent', 'signup-email-sent', 'Sign-up accepted, confirmation email sent'],
    ['Email confirmed', 'signup-confirmed', 'Confirmed the email: an active free account'],
    ['Plan limit hit', 'plan-limit-hit', 'Saved more suppliers than the plan allows'],
    ['Upgrade clicked', 'upgrade-click', 'Clicked a paid plan, on the way to Stripe Checkout'],
    ['Subscription started', 'subscription-started', 'Stripe Checkout completed (server side)'],
];
const EXCLUDED_PARAMS = ['t', 'client_reference_id', 'prefilled_email', 'fbclid', 'gclid'];

async function api(method, params = {}) {
    const body = new URLSearchParams({ module: 'API', format: 'JSON', method, token_auth: token });
    for (const [k, v] of Object.entries(params)) body.append(k, v);
    const r = await fetch(`${url}/index.php`, { method: 'POST', body });
    const j = await r.json();
    if (j?.result === 'error') throw new Error(`${method}: ${j.message}`);
    return j;
}

const site = (await api('SitesManager.getSiteFromId', { idSite }));
console.log(`site ${idSite}: ${site.name} (${site.main_url}), ecommerce ${site.ecommerce === '1' || site.ecommerce === 1 ? 'on' : 'OFF: enable it'}, currency ${site.currency}`);
const have = new Set((await api('Goals.getGoals', { idSite })).map((g) => g.name));
for (const [name, action, description] of GOALS) {
    if (have.has(name)) { console.log(`goal exists: ${name}`); continue; }
    await api('Goals.addGoal', { idSite, name, description, matchAttribute: 'event_action', pattern: action, patternType: 'exact', caseSensitive: '0', revenue: '0', allowMultipleConversionsPerVisit: '0' });
    console.log(`goal added: ${name}`);
}
const excluded = String(site.excluded_parameters || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const merged = [...new Set([...excluded, ...EXCLUDED_PARAMS])];
if (merged.length !== excluded.length) { await api('SitesManager.updateSite', { idSite, excludedQueryParameters: merged.join(',') }); console.log(`excluded query parameters: ${merged.join(', ')}`); }
console.log('done');
