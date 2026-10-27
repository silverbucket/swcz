// Outgoing mail via SMTP (nodemailer, e.g. Brevo: SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587). Without SMTP_HOST or SMTP_PASS, or with MAIL_DRY_RUN=1, mail goes to DATA_DIR/outbox/ instead.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

export function createMailer(env = process.env) {
    const outbox = path.join(env.DATA_DIR || 'data', 'outbox');
    const from = env.SMTP_FROM || 'Supplier Watch <noreply@supplierwatch.cz>';
    const replyTo = env.MAIL_REPLY_TO || 'contact@supplierwatch.cz';
    const dry = !env.SMTP_HOST || !env.SMTP_PASS || env.MAIL_DRY_RUN === '1';
    const transport = dry ? null : nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: Number(env.SMTP_PORT) === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });
    return {
        dry, outbox,
        /** Log in to the SMTP server without sending (health check). */
        async verify() { if (dry) return { dry: true }; await transport.verify(); return { ok: true }; },
        async send({ to, subject, text, unsubscribeUrl, manageUrl, attachments }) {
            const body = `${text}\n\n--\n${manageUrl ? `Manage your account / Správa účtu: ${manageUrl}\n` : ''}Unsubscribe / Odhlásit: ${unsubscribeUrl}\n`;
            const msg = { from, replyTo, to, subject, text: body, html: renderHtml({ subject, text, unsubscribeUrl, manageUrl }), headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
            if (attachments?.length) msg.attachments = attachments;
            if (dry) {
                fs.mkdirSync(outbox, { recursive: true });
                const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const stored = { ...msg, attachments: (attachments ?? []).map((a, i) => { const f = `${id}-${i}-${String(a.filename).replace(/[^\w.-]/g, '_')}`; fs.writeFileSync(path.join(outbox, f), a.content); return { filename: a.filename, contentType: a.contentType, file: f }; }) };
                fs.writeFileSync(path.join(outbox, `${id}.json`), JSON.stringify(stored, null, 1));
                return { dry: true };
            }
            return transport.sendMail(msg);
        },
    };
}

export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const URL_RE = /(https?:\/\/[^\s<>"')]+|[A-Za-z0-9._%+-]+@supplierwatch\.cz)/g;
/** Escape a line, then turn URLs and our contact address into links. */
export function linkify(line) {
    return String(line ?? '').split(URL_RE).map((part, i) => {
        if (i % 2 === 0) return escHtml(part);
        const href = part.includes('@') && !part.startsWith('http') ? `mailto:${part}` : part.replace(/[.,;:]+$/, '');
        const tail = part.slice(href.replace(/^mailto:/, '').length);
        return `<a href="${escHtml(href)}" style="color:#0b5cad;word-break:break-all">${escHtml(href.replace(/^mailto:/, ''))}</a>${escHtml(tail)}`;
    }).join('');
}
/** Simple inline-styled HTML version of a plain-text email. No images, no tracking. */
export function renderHtml({ subject, text, unsubscribeUrl, manageUrl }) {
    const rows = String(text).split('\n').map((l) => {
        const t = l.trim();
        if (!t) return '<div style="height:10px"></div>';
        let style = 'margin:0 0 4px;font-size:15px;line-height:1.45';
        if (t.startsWith('■')) style += ';font-weight:bold;margin-top:8px';
        else if (t.startsWith('!')) style += ';color:#b00020';
        else if (/^(Sources|Zdroje|Data:)/.test(t) || t.includes('ČOI')) style += ';font-size:12px;color:#666';
        if (l.startsWith('   ')) style += ';padding-left:16px';
        return `<p style="${style}">${linkify(t)}</p>`;
    }).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:600px;margin:0 auto;padding:16px">
<div style="background:#fff;border-radius:8px;padding:20px">
<p style="margin:0 0 14px;font-size:18px;font-weight:bold">Supplier Watch</p>
${rows}
</div>
<p style="font-size:12px;color:#666;text-align:center;margin:14px 0">Questions? Reply to this email or write to <a href="mailto:contact@supplierwatch.cz" style="color:#0b5cad">contact@supplierwatch.cz</a>.<br>
${manageUrl ? `<a href="${escHtml(manageUrl)}" style="color:#0b5cad">Manage your account / Správa účtu</a> · ` : ''}<a href="${escHtml(unsubscribeUrl)}" style="color:#0b5cad">Unsubscribe / Odhlásit</a> · <a href="https://supplierwatch.cz/" style="color:#0b5cad">supplierwatch.cz</a></p>
</div></body></html>`;
}
