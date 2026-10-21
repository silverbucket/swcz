#!/usr/bin/env node
// Operator tasks. Usage: node src/admin.js delete <email>
//   Deletes the account and all its data now (no grace period), e.g. for an erasure request you have verified.
import path from 'node:path';
import { Accounts } from './accounts.js';

const [cmd, email] = process.argv.slice(2);
if (cmd !== 'delete' || !email) { console.error('usage: node src/admin.js delete <email>'); process.exit(2); }
const acc = new Accounts(path.join(process.env.DATA_DIR || 'data', 'accounts.json'));
const a = acc.byEmail(email);
if (!a) { console.error(`no account for ${email}`); process.exit(1); }
if (acc.liveSubscription(a)) console.error(`warning: ${a.id} still has a paid subscription (${a.subscription}); cancel it in the Stripe dashboard`);
acc.erase(a.id);
console.log(`deleted ${a.id} (${a.email})`);
