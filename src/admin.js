#!/usr/bin/env node
// Operator tasks. Usage:
//   node src/admin.js delete <email>   Deletes the account and all its data, and the address on the updates list, now (no grace
//                                      period), e.g. for an erasure request you have verified.
//   node src/admin.js updates          Prints the confirmed updates list as CSV: email, confirmed_at, source, unsubscribe URL.
import path from 'node:path';
import { Accounts, normEmail } from './accounts.js';
import { Updates } from './updates.js';
import { deleteOutboxMail } from './history.js';

const [cmd, email] = process.argv.slice(2);
const file = path.join(process.env.DATA_DIR || 'data', 'accounts.json');
if (cmd === 'updates') {
    const base = (process.env.BASE_URL || 'https://supplierwatch.cz').replace(/\/$/, '');
    console.log('email,confirmed_at,source,unsubscribe_url');
    for (const r of new Updates(file).confirmed()) console.log([r.email, r.confirmed_at, r.source, `${base}/unsubscribe?u=${r.unsub}`].join(','));
    process.exit(0);
}
if (cmd !== 'delete' || !email) { console.error('usage: node src/admin.js delete <email> | updates'); process.exit(2); }
const acc = new Accounts(file);
const a = acc.byEmail(email);
deleteOutboxMail(path.dirname(file), [normEmail(email)]); // the updates confirmation mail, if SMTP is off; first, so a failure leaves it retryable
const onList = new Updates(file).remove(email);
if (onList) console.log(`removed ${normEmail(email)} from the updates list`);
if (!a) { if (!onList) { console.error(`no account and not on the updates list: ${email}`); process.exit(1); } process.exit(0); }
if (acc.liveSubscription(a)) console.error(`warning: ${a.id} still has a paid subscription (${a.subscription}); cancel it in the Stripe dashboard`);
acc.erase(a.id);
console.log(`deleted ${a.id} (${a.email})`);
