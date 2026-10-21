import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { runAll } from '../src/run.js';
import { createServer } from '../src/server.js';
import { applyEvent } from '../src/billing.js';
import { PLANS, PLAN_INFO } from '../src/plans.js';
import { tmp, icos, fakeWorld, mailbox, listen, post, makeAccount, accounts } from './fixtures/helpers.js';

test('plan config: Accountant is 990 Kč / month with 2,000 suppliers; Stripe amount and metadata map to it', () => {
    assert.equal(PLANS.accountant, 2000); assert.equal(PLAN_INFO.accountant.priceKc, 990); assert.equal(PLAN_INFO.accountant.clients, true); assert.equal(PLAN_INFO.pro.api, true); assert.equal(PLAN_INFO.starter.api, false);
    const dataDir = tmp('swacc0-'); const a = makeAccount(dataDir, 'u@x.cz'); const acc = accounts(dataDir); const x = acc.get(a.id); x.stripeCustomer = 'cus_1';
    acc.applyStripe({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'active', items: { data: [{ price: { unit_amount: 99000 } }] } } } });
    assert.equal(x.plan, 'accountant');
    acc.applyStripe({ type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, customer: 'cus_1', metadata: { plan: 'accountant' } } } }); assert.equal(x.plan, 'accountant');
    const store = { customers: {} }; applyEvent(store, { type: 'checkout.session.completed', data: { object: { customer: 'cus_2', metadata: { plan: 'accountant' } } } });
    assert.equal(store.customers.cus_2.supplierLimit, 2000);
});

test('client lists: shared 2,000 limit, recipients, unsubscribe per recipient, paused after downgrade', () => {
    const dataDir = tmp('swacc1-'); const a = makeAccount(dataDir, 'ucetni@x.cz', { plan: 'accountant', icos: icos(1500) });
    const acc = accounts(dataDir); const x = acc.get(a.id);
    const c1 = acc.addClient(x, 'Novák s.r.o.').client; const c2 = acc.addClient(x, 'Dvořák a.s.').client;
    assert.match(acc.addClient(x, '  ').error, /name/);
    assert.deepEqual(acc.setClientIcos(x, c1.id, icos(400, 20000000)), { kept: 400, dropped: 0 });
    assert.deepEqual(acc.setClientIcos(x, c2.id, icos(300, 30000000)), { kept: 100, dropped: 200 }, 'only 100 left of 2,000');
    assert.equal(acc.total(x), 2000);
    assert.deepEqual(acc.setIcos(x, icos(1600)), { kept: 1500, dropped: 100 }, 'own list cannot take the clients\' share');
    const rr = acc.setClientRecipients(x, c1.id, 'jana@novak.cz, bad-email, JANA@novak.cz; petr@novak.cz');
    assert.deepEqual(rr.recipients.map((r) => r.email), ['jana@novak.cz', 'petr@novak.cz']); assert.deepEqual(rr.invalid, ['bad-email']);
    const tok = rr.recipients[0].unsubToken; assert.equal(acc.setClientRecipients(x, c1.id, 'jana@novak.cz').recipients[0].unsubToken, tok, 'token kept');
    assert.equal(acc.unsubscribe(tok).id, a.id); assert.equal(x.unsubscribed, false, 'the accountant stays subscribed'); assert.equal(acc.lists(x)[1].recipients.length, 0);
    assert.deepEqual(acc.lists(x).map((l) => [l.name, l.icos.length]), [[null, 1500], ['Novák s.r.o.', 400], ['Dvořák a.s.', 100]]);
    x.plan = 'pro'; assert.deepEqual(acc.lists(x).map((l) => [l.name, l.icos.length]), [[null, 500]], 'client lists paused on Pro');
    assert.match(acc.addClient(x, 'New').error, /Accountant plan/);
    x.plan = 'accountant'; assert.equal(acc.removeClient(x, c2.id), true); assert.equal(acc.lists(x).length, 2);
});

test('daily run: each client list checked separately; client alert goes to the accountant and the client recipients', async () => {
    const dataDir = tmp('swacc2-'); const own = icos(2); const cl = icos(2, 40000000);
    const a = makeAccount(dataDir, 'ucetni@x.cz', { plan: 'accountant', icos: own });
    const acc = accounts(dataDir); const x = acc.get(a.id); const c = acc.addClient(x, 'Novák s.r.o.').client; acc.setClientIcos(x, c.id, cl); acc.setClientRecipients(x, c.id, 'jana@novak.cz'); acc.save();
    const { world, check } = fakeWorld(); const { sent, mailer } = mailbox();
    let t = Date.parse('2026-10-20T04:30:00Z'); const now = () => t;
    let s = await runAll({ dataDir, mailer, check, log: () => {}, now }); assert.equal(s.checked, 2); assert.equal(sent.length, 0);
    t = Date.parse('2026-10-21T04:30:00Z'); world.unreliable[cl[1]] = 'ANO';
    s = await runAll({ dataDir, mailer, check, log: () => {}, now });
    assert.deepEqual(sent.map((m) => m.to).sort(), ['jana@novak.cz', 'ucetni@x.cz']);
    for (const m of sent) { assert.match(m.subject, /Novák s\.r\.o\./); assert.match(m.text, new RegExp(cl[1])); assert.doesNotMatch(m.text, new RegExp(own[0])); }
    const jana = sent.find((m) => m.to === 'jana@novak.cz'); const tok = accounts(dataDir).client(accounts(dataDir).get(a.id), c.id).recipients[0].unsubToken;
    assert.match(jana.unsubscribeUrl, new RegExp(`t=${tok}$`)); assert.match(jana.text, /set up for you by ucetni@x\.cz/);
});

test('manage page: add client, edit its suppliers and recipients, per-client report link, delete', async () => {
    const dataDir = tmp('swacc3-'); const a = makeAccount(dataDir, 'ucetni@x.cz', { plan: 'accountant', icos: icos(1) });
    const srv = createServer({ dataDir, mailer: mailbox().mailer, log: () => {} }); const url = await listen(srv);
    try {
        const acc = accounts(dataDir); const t = acc.issue(a.id, 'manage'); acc.save();
        let html = await (await fetch(`${url}/manage?t=${t}`)).text(); assert.match(html, /Clients \/ Klienti/); assert.match(html, /1 of 2,000 suppliers used/);
        html = await (await post(`${url}/manage`, { t, action: 'add_client', name: 'Novák s.r.o.' })).text(); assert.match(html, /Client added/);
        const cid = accounts(dataDir).get(a.id).clients[0].id;
        const body = new URLSearchParams({ t, action: 'save_client', client: cid, name: 'Novák a syn s.r.o.', recipients: 'jana@novak.cz' });
        for (const i of icos(3, 50000000)) { body.append('ico', i); body.append('web', ''); }
        html = await (await post(`${url}/manage`, body.toString(), { 'content-type': 'application/x-www-form-urlencoded' })).text();
        assert.match(html, /Saved 3 suppliers/); assert.match(html, /Novák a syn s\.r\.o\./); assert.match(html, /jana@novak\.cz/);
        assert.match(html, new RegExp(`name="client" value="${cid}"`)); assert.match(html, /first PDF report appears here/);
        const c = accounts(dataDir).get(a.id).clients[0]; assert.equal(c.icos.length, 3); assert.equal(c.recipients[0].email, 'jana@novak.cz');
        assert.equal((await fetch(`${url}/manage?t=${t}&client=cl_nope`)).status, 404);
        html = await (await post(`${url}/manage`, { t, action: 'delete_client', client: cid })).text(); assert.match(html, /Client deleted/);
        assert.equal(accounts(dataDir).get(a.id).clients.length, 0);
        // a Pro account cannot add clients
        const p = makeAccount(dataDir, 'pro@x.cz', { plan: 'pro' }); const acc2 = accounts(dataDir); const tp = acc2.issue(p.id, 'manage'); acc2.save();
        assert.equal((await post(`${url}/manage`, { t: tp, action: 'add_client', name: 'X' })).status, 400);
        html = await (await fetch(`${url}/manage?t=${tp}`)).text(); assert.match(html, /Accountant: 2,000 suppliers, client lists \+ API, 990 Kč \/ month/); assert.match(html, /buy\.stripe\.com\/test_14AdR92KNeiL730fys1ZS02/);
    } finally { srv.close(); }
});

test('Stripe webhook upgrades to Accountant via metadata', async () => {
    const SECRET = 'whsec_acc'; const dataDir = tmp('swacc4-'); const a = makeAccount(dataDir, 'u@x.cz');
    const srv = createServer({ dataDir, secret: SECRET, mailer: mailbox().mailer, log: () => {} }); const url = await listen(srv);
    try {
        const b = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, customer: 'cus_A', subscription: 'sub_A', metadata: { plan: 'accountant' } } } });
        const ts = Math.floor(Date.now() / 1000); const sig = `t=${ts},v1=${crypto.createHmac('sha256', SECRET).update(`${ts}.${b}`).digest('hex')}`;
        assert.equal((await post(`${url}/stripe/webhook`, b, { 'stripe-signature': sig })).status, 200);
        assert.equal(accounts(dataDir).get(a.id).plan, 'accountant');
    } finally { srv.close(); }
});

test('Stripe: events of another subscription do not change the plan; paid accounts upgrade in the portal, not a new Checkout', async () => {
    const acc = accounts(tmp('swsub-'));
    const { account: a } = acc.signup('s@x.cz', [], { consentText: 'c' });
    acc.applyStripe({ type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, customer: 'cus_1', subscription: 'sub_new', metadata: { plan: 'pro' } } } });
    acc.applyStripe({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_1' } } }); assert.equal(a.plan, 'pro');
    acc.applyStripe({ type: 'customer.subscription.updated', data: { object: { id: 'sub_old', customer: 'cus_1', status: 'active', metadata: { plan: 'starter' } } } }); assert.equal(a.plan, 'pro');
    acc.applyStripe({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_new', customer: 'cus_1' } } }); assert.equal(a.plan, 'free');
    acc.applyStripe({ type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, customer: 'cus_1', subscription: 'sub_2', amount_subtotal: 99000 } } }); assert.equal(a.plan, 'accountant');
});

test('Stripe review fixes: a recovered subscription is live again; a portal plan switch follows the price, not stale metadata', () => {
    const acc = accounts(tmp('swsub-'));
    const { account: a } = acc.signup('t@x.cz', [], { consentText: 'c' });
    acc.applyStripe({ type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, customer: 'cus_1', subscription: 'sub_1', metadata: { plan: 'starter' } } } });
    const upd = (status, price) => acc.applyStripe({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status, metadata: { plan: 'starter' }, items: { data: [{ price }] } } } });
    upd('unpaid', { unit_amount: 19000 }); assert.equal(a.plan, 'free'); assert.equal(a.subscription, null);
    upd('active', { unit_amount: 19000 }); assert.equal(a.plan, 'starter'); assert.equal(a.subscription, 'sub_1'); assert.ok(acc.liveSubscription(a));
    upd('active', { unit_amount: 49000 }); assert.equal(a.plan, 'pro', 'switched to Pro in the portal; subscription metadata still says starter');
});
