import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySignature, applyEvent, supplierLimit } from '../src/billing.js';

const SECRET = 'whsec_test123';
export const sign = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('signature verification', () => {
    const b = '{"a":1}';
    assert.equal(verifySignature(b, sign(b), SECRET), true);
    assert.equal(verifySignature(b + ' ', sign(b), SECRET), false);
    assert.equal(verifySignature(b, sign(b, 1000), SECRET), false);
    assert.equal(verifySignature(b, undefined, SECRET), false);
});

test('legacy customer-store mapping', () => {
    const s = { customers: {} };
    applyEvent(s, { type: 'checkout.session.completed', data: { object: { customer: 'cus_1', metadata: { plan: 'pro' } } } });
    assert.equal(supplierLimit(s, 'cus_1'), 500);
    applyEvent(s, { type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    assert.equal(supplierLimit(s, 'cus_1'), 5);
});
