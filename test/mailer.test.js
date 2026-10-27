import test from 'node:test';
import assert from 'node:assert';
import { createMailer } from '../src/mailer.js';
test('mail falls back to outbox when SMTP_PASS is empty', () => {
    assert.equal(createMailer({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_USER: 'u', SMTP_PASS: '', DATA_DIR: '/tmp/x' }).dry, true);
    assert.equal(createMailer({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_USER: 'u', SMTP_PASS: 'k', DATA_DIR: '/tmp/x' }).dry, false);
});
import { renderHtml, linkify } from '../src/mailer.js';
import fs from 'node:fs';
test('HTML part escapes values and links URLs', () => {
    const h = renderHtml({ subject: 'S', text: '■ <script>x</script> (IČO 1)\n   ISIR 1 https://isir.justice.cz/a?b=1&c=2\nwrite to contact@supplierwatch.cz.', unsubscribeUrl: 'https://supplierwatch.cz/unsubscribe?t=a"b' });
    assert.ok(!h.includes('<script>')); assert.ok(h.includes('&lt;script&gt;'));
    assert.ok(h.includes('href="https://isir.justice.cz/a?b=1&amp;c=2"'));
    assert.ok(h.includes('href="mailto:contact@supplierwatch.cz"'));
    assert.ok(h.includes('unsubscribe?t=a&quot;b')); assert.ok(!/<img/i.test(h));
    assert.equal(linkify('see https://x.cz/a.'), 'see <a href="https://x.cz/a" style="color:#0b5cad;word-break:break-all">https://x.cz/a</a>.');
});
test('outbox message is multipart with List-Unsubscribe', async () => {
    const dir = fs.mkdtempSync('/tmp/mt'); const m = createMailer({ DATA_DIR: dir });
    await m.send({ to: 'a@b.cz', subject: 's', text: 'hi https://supplierwatch.cz/#manage', unsubscribeUrl: 'https://u' });
    const f = fs.readdirSync(m.outbox)[0]; const msg = JSON.parse(fs.readFileSync(`${m.outbox}/${f}`));
    assert.ok(msg.text.includes('https://u')); assert.ok(msg.html.includes('href="https://supplierwatch.cz/#manage"'));
    assert.equal(msg.headers['List-Unsubscribe'], '<https://u>');
});
test('footer carries the manage link next to unsubscribe when given', () => {
    const h = renderHtml({ subject: 'S', text: 'x', unsubscribeUrl: 'https://supplierwatch.cz/unsubscribe?t=u', manageUrl: 'https://supplierwatch.cz/manage?t=m' });
    assert.ok(h.includes('href="https://supplierwatch.cz/manage?t=m"') && h.includes('Manage your account / Správa účtu'));
    assert.ok(!renderHtml({ subject: 'S', text: 'x', unsubscribeUrl: 'u' }).includes('Správa účtu'));
});
test('plain-text footer includes the manage link', async () => {
    const dir = fs.mkdtempSync('/tmp/swmail-'); const m = createMailer({ DATA_DIR: dir });
    await m.send({ to: 'a@b.cz', subject: 'S', text: 'x', unsubscribeUrl: 'https://u', manageUrl: 'https://supplierwatch.cz/manage?t=m' });
    const f = fs.readdirSync(`${dir}/outbox`).find((n) => n.endsWith('.json')); const msg = JSON.parse(fs.readFileSync(`${dir}/outbox/${f}`, 'utf8'));
    assert.ok(msg.text.includes('Manage your account / Správa účtu: https://supplierwatch.cz/manage?t=m'));
});
