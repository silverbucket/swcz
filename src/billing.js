// Stripe webhook handling: verify signature, map customer -> plan + supplier limit.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PLANS, PLAN_BY_AMOUNT } from './plans.js';
export { PLANS };

export function verifySignature(rawBody, header, secret, toleranceSec = 300, now = Date.now() / 1000) {
    if (!header || !secret) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
    const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    const t = Number(parts.t);
    if (!t || !sigs.length || Math.abs(now - t) > toleranceSec) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

const planOf = (meta) => (meta?.plan && PLANS[meta.plan] !== undefined ? meta.plan : null);
function planFromSub(sub) {
    return planOf(sub.metadata) ?? planOf(sub.items?.data?.[0]?.price?.metadata)
        ?? PLAN_BY_AMOUNT[sub.items?.data?.[0]?.price?.unit_amount] ?? null;
}

export function loadStore(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { customers: {} }; }
export function saveStore(file, store) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(store, null, 1)); fs.renameSync(tmp, file);
}

/** Apply one Stripe event to the store. Returns a short description or null if ignored. */
export function applyEvent(store, ev) {
    const o = ev.data?.object ?? {};
    const upsert = (id, patch) => { store.customers[id] = { ...(store.customers[id] ?? {}), ...patch, updatedAt: new Date((ev.created ?? Date.now() / 1000) * 1000).toISOString() }; return store.customers[id]; };
    switch (ev.type) {
    case 'checkout.session.completed': {
        if (!o.customer) return null;
        const plan = planOf(o.metadata) ?? 'starter';
        const c = upsert(o.customer, { email: o.customer_details?.email ?? o.customer_email ?? null, subscription: o.subscription ?? null, plan, supplierLimit: PLANS[plan], status: 'active' });
        return `${o.customer} -> ${c.plan}`;
    }
    case 'customer.subscription.updated': {
        const active = ['active', 'trialing', 'past_due'].includes(o.status);
        const plan = active ? (planFromSub(o) ?? store.customers[o.customer]?.plan ?? 'free') : 'free';
        upsert(o.customer, { subscription: o.id, plan, supplierLimit: PLANS[plan], status: o.status });
        return `${o.customer} -> ${plan} (${o.status})`;
    }
    case 'customer.subscription.deleted':
        upsert(o.customer, { subscription: null, plan: 'free', supplierLimit: PLANS.free, status: 'canceled' });
        return `${o.customer} -> free (canceled)`;
    default: return null;
    }
}

export function supplierLimit(store, customerId) { return store.customers[customerId]?.supplierLimit ?? PLANS.free; }
