// Shared test helpers (no tests here).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkWatchlist } from '../../src/check.js';
import { Accounts } from '../../src/accounts.js';
import { isValidIco } from '../../src/ico.js';

export const tmp = (p = 'sw-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
/** First n valid IČO numbers from a deterministic sequence. */
export function icos(n, start = 10000000) { const out = []; for (let i = start; out.length < n; i++) { const s = String(i).padStart(8, '0'); if (isValidIco(s)) out.push(s); } return out; }
/** Fake register sources; mutate `world` to change what they return. */
export function fakeWorld() {
    const world = { unreliable: {}, accounts: {}, insolvent: {}, down: {}, name: {} };
    const sources = {
        ares: async (ico) => { if (world.down.ares) throw new Error('ares down'); return { found: true, ico, name: world.name[ico] ?? `Firma ${ico} s.r.o.`, address: 'Praha 7', dic: `CZ${ico}`, aresInsolvencyFlag: 'NEEXISTUJICI', aresPublicRegisterFlag: 'NEEXISTUJICI' }; },
        dph: async (dics) => { if (world.down.dph) throw new Error('dph down'); return { generated: '2026-10-21', subjects: new Map(dics.map((d) => [d, { dic: d, subjectType: 'PLATCE_DPH', unreliable: world.unreliable[d] ?? 'NE', accounts: world.accounts[d] ?? ['123-4567/0100'] }])) }; },
        isir: async (ico) => { if (world.down.isir) throw new Error('isir down'); return { cases: world.insolvent[ico] ? [{ caseNo: 'INS 1/2026', state: 'MORATORIUM', ended: null, url: 'https://isir.justice.cz/x' }] : [] }; },
    };
    const check = (items, opts) => checkWatchlist(items, { ...opts, sources });
    return { world, sources, check };
}
export const mailbox = () => { const sent = []; return { sent, mailer: { send: async (m) => { sent.push(m); } } }; };
export const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
export const post = (url, data, headers = {}) => fetch(url, { method: 'POST', body: typeof data === 'string' ? data : new URLSearchParams(data), headers, redirect: 'manual' });
/** Create a confirmed account directly in the data dir. */
export function makeAccount(dataDir, email, { plan = 'free', icos: list = [], websites = {} } = {}) {
    const acc = new Accounts(path.join(dataDir, 'accounts.json'));
    const { account } = acc.signup(email, [], { consentText: 'x' });
    account.confirmed = true; account.plan = plan; account.icos = list; account.websites = websites; acc.save();
    return account;
}
export const accounts = (dataDir) => new Accounts(path.join(dataDir, 'accounts.json'));
