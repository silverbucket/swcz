// Single source of truth for plans: supplier limit (total across all client lists), monthly price, features.
export const PLAN_INFO = {
    free: { name: 'Free', limit: 5, priceKc: 0, api: false, clients: false },
    starter: { name: 'Starter', limit: 50, priceKc: 190, api: false, clients: false },
    pro: { name: 'Pro', limit: 500, priceKc: 490, api: true, clients: false },
    accountant: { name: 'Accountant', limit: 2000, priceKc: 990, api: true, clients: true },
};
export const PLANS = Object.fromEntries(Object.entries(PLAN_INFO).map(([k, v]) => [k, v.limit]));
/** Stripe unit_amount (haléře) -> plan, used when a subscription carries no plan metadata. */
export const PLAN_BY_AMOUNT = Object.fromEntries(Object.entries(PLAN_INFO).filter(([, v]) => v.priceKc).map(([k, v]) => [v.priceKc * 100, k]));
export const kc = (n) => `${Number(n).toLocaleString('en-US').replace(/,/g, ',')} Kč`;
export const MAX_CLIENTS = 200;
