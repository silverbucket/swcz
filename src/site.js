// One switch for the whole service: MONITORING_ENABLED (default on). Set it to "false" (or 0/no/off) to pause ongoing
// monitoring: sign-up, pricing, manage pages and the API go, the daily run only does its source self-check and
// housekeeping, and the free one-off check and the updates list stay.
// Pages mark the alternatives with <!--if monitoring-->...<!--end--> and <!--if paused-->...<!--end--> (no nesting).
// nginx serves the pages from SITE_DIR (default DATA_DIR/site), which the app writes on start for the current setting.
import fs from 'node:fs';
import path from 'node:path';

export const monitoringEnabled = (env = process.env) => !/^(0|false|no|off)$/i.test(String(env.MONITORING_ENABLED ?? '').trim());

const BLOCK = /<!--if (monitoring|paused)-->([\s\S]*?)<!--end-->/g;
/** The page as it should be served for the current setting. */
export const sitePage = (html, on) => String(html).replace(BLOCK, (_, k, body) => ((k === 'monitoring') === on ? body : ''));

/** Copy the site directory to `dest`, rendering every .html page for the setting. Files are replaced one by one (no gap). */
export function writeSite(src, dest, on) {
    let n = 0;
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, e.name); const to = path.join(dest, e.name);
        if (e.isDirectory()) { n += writeSite(from, to, on); continue; }
        fs.mkdirSync(dest, { recursive: true });
        const buf = fs.readFileSync(from);
        fs.writeFileSync(`${to}.tmp`, e.name.endsWith('.html') ? sitePage(buf.toString('utf8'), on) : buf); fs.renameSync(`${to}.tmp`, to);
        n++;
    }
    return n;
}
