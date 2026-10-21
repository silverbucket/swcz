#!/usr/bin/env node
// Operator tasks. Usage:
//   node src/admin.js delete <email>   Deletes the account and all its data now (no grace period), e.g. for an erasure request you have verified.
//   node src/admin.js updates          Prints the confirmed updates list as CSV: email, confirmed_at, source, unsubscribe URL.
import path from 'node:path';
import { Accounts } from './accounts.js';
import { Updates } from './updates.js';

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
if (!a) { console.error(`no account for ${email}`); process.exit(1); }
if (acc.liveSubscription(a)) console.error(`warning: ${a.id} still has a paid subscription (${a.subscription}); cancel it in the Stripe dashboard`);
acc.erase(a.id);
console.log(`deleted ${a.id} (${a.email})`);
