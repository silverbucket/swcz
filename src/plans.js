// Single source of truth for plans: supplier limit (total across all client lists), monthly price, features.
// Annual billing is 10 months' price (yearKc). Pro is hidden: existing Pro subscriptions keep working, but it is
// not shown on the site or offered as an upgrade.
export const PLAN_INFO = {
    free: { name: 'Free', limit: 5, priceKc: 0, api: false, clients: false },
    starter: { name: 'Starter', limit: 50, priceKc: 190, yearKc: 1900, api: false, clients: false },
    pro: { name: 'Pro', limit: 500, priceKc: 490, api: true, clients: false, hidden: true },
    accountant: { name: 'Accountant', limit: 2000, priceKc: 990, yearKc: 9900, api: true, clients: true },
};
/** Paid plans offered on the site and as upgrades, in order. */
export const OFFERED = Object.keys(PLAN_INFO).filter((k) => PLAN_INFO[k].priceKc && !PLAN_INFO[k].hidden);
export const PLANS = Object.fromEntries(Object.entries(PLAN_INFO).map(([k, v]) => [k, v.limit]));
/** Stripe unit_amount (haléře), monthly or annual -> plan, used when a subscription carries no plan metadata. */
export const PLAN_BY_AMOUNT = Object.fromEntries(Object.entries(PLAN_INFO).flatMap(([k, v]) => [...(v.priceKc ? [[v.priceKc * 100, k]] : []), ...(v.yearKc ? [[v.yearKc * 100, k]] : [])]));
export const kc = (n) => `${Number(n).toLocaleString('en-US').replace(/,/g, ',')} Kč`;
export const MAX_CLIENTS = 200;
