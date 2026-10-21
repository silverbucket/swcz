// Updates list: people who want an email when monitoring is back or something new launches. Double opt-in, one row per
// address in accounts.db; an unsubscribe deletes the row, unconfirmed requests go after 7 days (daily run).
// Sign-ups for monitoring that tick the updates box are added confirmed when they confirm their account.
import crypto from 'node:crypto';
import { openDb, normEmail, TOKEN_TTL_MS } from './accounts.js';

export const UPDATES_CONSENT = 'I want to receive occasional emails about Supplier Watch updates. I can unsubscribe with the link in every email. / Chci dostávat občasné e-maily o novinkách Supplier Watch, odhlásit se mohu odkazem v každém e-mailu.';
const token = () => crypto.randomBytes(24).toString('base64url');
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export class Updates {
    constructor(file, { now = () => Date.now() } = {}) { this.sql = openDb(file); this.now = now; }
    get(email) { return this.sql.prepare('SELECT * FROM updates WHERE email = ?').get(normEmail(email)) ?? null; }
    /** New or repeated request: returns { confirmToken, unsub } to email, or { confirmed: true } if already on the list. */
    request(email, consent = UPDATES_CONSENT) {
        const e = normEmail(email); const cur = this.get(e);
        if (cur?.confirmed_at) return { confirmed: true };
        const t = token(); const unsub = cur?.unsub ?? token();
        this.sql.prepare(`INSERT INTO updates (email, created_at, consent, source, confirm_hash, confirm_exp, unsub) VALUES (?, ?, ?, 'form', ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET created_at = excluded.created_at, consent = excluded.consent, confirm_hash = excluded.confirm_hash, confirm_exp = excluded.confirm_exp`)
            .run(e, new Date(this.now()).toISOString(), consent, hash(t), this.now() + TOKEN_TTL_MS.confirm, unsub);
        return { confirmToken: t, unsub };
    }
    /** Confirm a request by its token. Returns the row, or null if unknown or expired. */
    confirm(t) {
        const r = t && this.sql.prepare('SELECT * FROM updates WHERE confirm_hash = ?').get(hash(t));
        if (!r || r.confirm_exp < this.now()) return null;
        this.sql.prepare('UPDATE updates SET confirmed_at = ?, confirm_hash = NULL, confirm_exp = NULL WHERE email = ?').run(new Date(this.now()).toISOString(), r.email);
        return this.get(r.email);
    }
    /** Add an address that is already confirmed (an account sign-up confirmed with the updates box ticked). */
    addConfirmed(email, consent = UPDATES_CONSENT, source = 'signup') {
        const at = new Date(this.now()).toISOString();
        this.sql.prepare(`INSERT INTO updates (email, created_at, confirmed_at, consent, source, unsub) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET confirmed_at = coalesce(updates.confirmed_at, excluded.confirmed_at), confirm_hash = NULL, confirm_exp = NULL`)
            .run(normEmail(email), at, at, consent, source, token());
    }
    /** Remove an address outright (erasure, or an account owner's "stop all emails"). Returns whether it was there. */
    remove(email) { return this.sql.prepare('DELETE FROM updates WHERE email = ?').run(normEmail(email)).changes > 0; }
    /** Remove the address with this unsubscribe token. Returns the email, or null. */
    unsubscribe(u) { return (u && this.sql.prepare('DELETE FROM updates WHERE unsub = ? RETURNING email').get(String(u))?.email) ?? null; }
    confirmed() { return this.sql.prepare('SELECT email, confirmed_at, source, unsub FROM updates WHERE confirmed_at IS NOT NULL ORDER BY confirmed_at').all(); }
    purgeUnconfirmed(days = 7) {
        return this.sql.prepare('DELETE FROM updates WHERE confirmed_at IS NULL AND created_at < ?').run(new Date(this.now() - days * 864e5).toISOString()).changes;
    }
}
