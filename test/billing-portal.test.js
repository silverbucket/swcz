import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { Accounts } from '../src/accounts.js';

function mk(env) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swbill-'));
    const calls = [];
    const srv = createServer({ env, dataDir, secret: 'x', baseUrl: 'https://sw.test', mailer: { send: async () => {} }, log: () => {},
        stripePortal: async (cus, ret) => { calls.push([cus, ret]); return 'https://billing.stripe.com/p/session/test_1'; } });
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    const { account } = acc.signup('a@b.cz', ['27082440'], { consentText: 'c' });
    account.confirmed = true;
    const t = acc.issue(account.id, 'manage'); acc.save();
    return { srv, dataDir, calls, t, id: account.id };
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const setPlan = (dataDir, id, patch) => { const acc = new Accounts(path.join(dataDir, 'accounts.json')); Object.assign(acc.get(id), patch); acc.save(); };

test('billing portal: button only for paid accounts with key, redirects to Stripe', async () => {
    const { srv, dataDir, calls, t, id } = mk({ STRIPE_SECRET_KEY: 'rk_test_x' }); const url = await listen(srv);
    try {
        assert.doesNotMatch(await (await fetch(`${url}/manage?t=${t}`)).text(), /value="billing"/);
        assert.equal((await fetch(`${url}/billing`, { method: 'POST', body: new URLSearchParams({ t }), redirect: 'manual' })).status, 400);
        setPlan(dataDir, id, { plan: 'starter', stripeCustomer: 'cus_1' });
        assert.match(await (await fetch(`${url}/manage?t=${t}`)).text(), /name="action" value="billing"/);
        assert.match(await (await fetch(`${url}/manage?t=${t}`)).text(), /buy\.stripe\.com/, 'no subscription recorded yet: Checkout links');
        setPlan(dataDir, id, { subscription: 'sub_1' });
        const paid = await (await fetch(`${url}/manage?t=${t}`)).text();
        assert.doesNotMatch(paid, /buy\.stripe\.com/, 'a paid subscription must not start a second one'); assert.match(paid, /Change plan/);
        // the button posts to /manage (a path nginx already proxies)
        const viaManage = await fetch(`${url}/manage`, { method: 'POST', body: new URLSearchParams({ t, action: 'billing' }), redirect: 'manual' });
        assert.equal(viaManage.status, 303); calls.length = 0;
        const r = await fetch(`${url}/billing`, { method: 'POST', body: new URLSearchParams({ t }), redirect: 'manual' });
        assert.equal(r.status, 303); assert.equal(r.headers.get('location'), 'https://billing.stripe.com/p/session/test_1');
        assert.deepEqual(calls[0], ['cus_1', `https://sw.test/manage?t=${t}`]);
        assert.equal((await fetch(`${url}/billing`, { method: 'POST', body: new URLSearchParams({ t: 'bad' }), redirect: 'manual' })).status, 400);
    } finally { srv.close(); }
});

test('billing portal: hidden without Stripe key', async () => {
    const { srv, dataDir, t, id } = mk({}); setPlan(dataDir, id, { plan: 'pro', stripeCustomer: 'cus_1' }); const url = await listen(srv);
    try { assert.doesNotMatch(await (await fetch(`${url}/manage?t=${t}`)).text(), /value="billing"/); } finally { srv.close(); }
});

test('cancel_at_period_end keeps plan until subscription.deleted', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'swb-')), 'a.json'); const acc = new Accounts(f);
    const { account: a } = acc.signup('c@d.cz', ['27082440'], { consentText: 'c' }); a.plan = 'starter'; a.stripeCustomer = 'cus_9';
    acc.applyStripe({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_9', id: 'sub_1', status: 'active', cancel_at_period_end: true, cancel_at: 1800000000, items: { data: [{ price: { unit_amount: 19000 } }] } } } });
    assert.equal(a.plan, 'starter'); assert.equal(a.cancelAt, 1800000000);
    acc.applyStripe({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_9', id: 'sub_1', status: 'canceled' } } });
    assert.equal(a.plan, 'free'); assert.equal(a.cancelAt, null);
});
