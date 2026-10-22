// Hourly end-to-end self-check of what visitors use, through the public URL (so nginx, TLS and the static pages count):
// the home page has the right sign-up form, the sign-up form answers (the updates list while monitoring is paused),
// the free IČO check returns a result, and the SMTP server accepts our login. Probe requests carry a secret header
// that only this process knows, so the app runs the real validation but stores nothing, sends no mail and skips the
// rate limits. A new failure, a different set of failures and a recovery are emailed to HEALTH_EMAIL (or OPS_EMAIL).
// Status is in DATA_DIR/health.json and at /healthz?detail=1.
import fs from 'node:fs';
import path from 'node:path';
import { CANARY_ICO } from './canary.js';
import { monitoringEnabled } from './site.js';

export const PROBE_HEADER = 'x-sw-health';
export const PROBE_EMAIL = 'health-check@supplierwatch.cz';
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

export function healthFile(dataDir) { return path.join(dataDir, 'health.json'); }
export function readHealth(dataDir) { try { return JSON.parse(fs.readFileSync(healthFile(dataDir), 'utf8')); } catch { return null; } }

export const PROBES = {
    async home({ get, on }) {
        const r = await get('/'); must(r.status === 200, `home page HTTP ${r.status}`);
        const h = await r.text(); must(!/<!--(if (monitoring|paused)|end)-->/.test(h), 'home page is the unrendered template (nginx root is not SITE_DIR?)');
        must(h.includes('action="/signup"'), 'home page has no sign-up form');
        must(h.includes('name="updates"') === !on, on ? 'home page shows the paused version (site not rewritten?)' : 'home page shows the monitoring version (site not rewritten?)');
    },
    async signup({ post, on }) {
        const r = await post('/signup', on ? { email: PROBE_EMAIL, consent: 'yes', ico: CANARY_ICO } : { email: PROBE_EMAIL, consent: 'yes', updates: '1' });
        must(r.status === 200, `sign-up HTTP ${r.status}`); must(/Check your email/.test(await r.text()), 'sign-up did not confirm');
    },
    async freecheck({ post }) {
        // On a cache miss the registers' own timeouts and retries can exceed a minute; wait longer than nginx does
        // (proxy_read_timeout, 60 s by default), so the probe fails only when a visitor would.
        const r = await post('/manage-link?freecheck=1', { ico: CANARY_ICO }, 120e3);
        must(r.status === 200, `free check HTTP ${r.status}`);
        const res = (await r.text()).match(/data-result="(\w+)"[^>]*>[^<]*IČO (\d{8})/);
        must(res && res[2] === CANARY_ICO, 'free check returned no result');
        must(res[1] !== 'error', 'free check: no register answered'); // a single register down is the data-source self-check's job
    },
    async smtp({ mailer }) {
        must(mailer?.verify, 'mailer cannot verify'); const v = await mailer.verify();
        must(!v?.dry, 'SMTP not configured: mail goes to the outbox');
    },
};
export const PROBE_NAMES = { home: 'Home page', signup: 'Sign-up form', freecheck: 'Free IČO check', smtp: 'SMTP login' };

/** Run all probes once. Returns { checkedAt, ok, monitoring, probes: { home: { ok, ms, error? } ... }, failed }. */
export async function runHealth({ env = process.env, dataDir = env.DATA_DIR || 'data', baseUrl, token, mailer, probes = PROBES, fetchFn = globalThis.fetch, log = console.error, now = () => Date.now(), timeoutMs = 30000 } = {}) {
    const base = (baseUrl || env.BASE_URL || 'https://supplierwatch.cz').replace(/\/$/, '');
    const on = monitoringEnabled(env);
    const req = (p, body, ms = timeoutMs) => fetchFn(`${base}${p}`, { method: body ? 'POST' : 'GET', body: body ? new URLSearchParams(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(ms), headers: { [PROBE_HEADER]: token, 'user-agent': 'SupplierWatch-health' } });
    const ctx = { get: (p) => req(p), post: req, on, mailer };
    const results = {};
    for (const [name, probe] of Object.entries(probes)) {
        const t0 = now();
        try { await probe(ctx); results[name] = { ok: true, ms: now() - t0 }; } catch (e) { results[name] = { ok: false, ms: now() - t0, error: String(e.message).slice(0, 300) }; }
    }
    const failed = Object.keys(results).filter((k) => !results[k].ok);
    const prev = readHealth(dataDir);
    if (failed.length) log(`health: FAILED ${failed.map((f) => `${f} (${results[f].error})`).join(', ')}`);
    // `notified` is the state the operator was last told about (all OK at first). It only advances when the email went
    // out, so an alert or recovery that could not be sent is retried on the next run.
    let notified = prev?.notified ?? { failed: [] };
    if (failed.join() !== notified.failed.join()) {
        const to = env.HEALTH_EMAIL || env.OPS_EMAIL || 'contact@supplierwatch.cz';
        const at = new Date(now()).toISOString();
        const [subject, text] = failed.length
            ? [`Supplier Watch ops: health check FAILED (${failed.map((f) => PROBE_NAMES[f] ?? f).join(', ')})`,
                `The hourly health check of ${base} failed at ${at}:\n\n${failed.map((f) => `${PROBE_NAMES[f] ?? f}: ${results[f].error}`).join('\n')}\n\nYou get another email when this changes or recovers.\nStatus: ${base}/healthz?detail=1`]
            : ['Supplier Watch ops: health check OK again', `All health checks of ${base} passed at ${at}.`];
        try {
            if (!mailer) throw new Error('no mailer');
            const r = await mailer.send({ to, unsubscribeUrl: `${base}/`, subject, text });
            if (r?.dry) throw new Error('SMTP not configured, written to the outbox only'); // not delivered: try again next run
            notified = { failed, at };
        } catch (e) { log(`health mail failed, retried next run: ${e.message}`); }
    }
    const st = { checkedAt: new Date(now()).toISOString(), ok: !failed.length, monitoring: on, probes: results, failed, notified };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(`${healthFile(dataDir)}.tmp`, JSON.stringify(st, null, 1)); fs.renameSync(`${healthFile(dataDir)}.tmp`, healthFile(dataDir));
    return st;
}

/** Run the health check every HEALTH_INTERVAL_MIN minutes (default 60), first 2 minutes after start. HEALTH_DISABLED=1 turns it off. */
export function startHealth({ env = process.env, log = console.error, ...opts } = {}) {
    if (env.HEALTH_DISABLED === '1') return null;
    let running = false;
    const tick = async () => { if (running) return; running = true; try { await runHealth({ env, log, ...opts }); } catch (e) { log(`health error: ${e.message}`); } finally { running = false; } };
    const first = setTimeout(tick, 120e3); const every = setInterval(tick, Number(env.HEALTH_INTERVAL_MIN || 60) * 60e3);
    first.unref(); every.unref();
    return { stop: () => { clearTimeout(first); clearInterval(every); }, tick };
}
