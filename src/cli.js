#!/usr/bin/env node
// Usage: node src/cli.js check --watchlist demo/watchlist.csv [--state state/demo.json] [--out reports] [--no-isir] [--no-coi] [--data dir]
import fs from 'node:fs';
import path from 'node:path';
import { runWatchlist } from './runner.js';
import { normaliseWebsite } from './accounts.js';
import { loadCoiList } from './sources/coi.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (args[0] !== 'check') { console.error('usage: check --watchlist file.csv [--state file.json] [--out dir] [--no-isir] [--no-coi] [--data dir]'); process.exit(2); }

const wl = opt('watchlist');
const name = path.basename(wl, path.extname(wl));
// CSV: ico,label,expected_account,website (header optional; # comments allowed)
const items = fs.readFileSync(wl, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !/^ico\b/i.test(l))
    .map((l) => { const [ico, label, expectedAccount, website] = l.split(',').map((s) => s?.trim()); const w = website ? normaliseWebsite(website) : null; if (website && !w) console.error(`ignoring invalid website for ${ico}: ${website}`); return { ico, label: label || null, expectedAccount: expectedAccount || null, website: w }; });
const coi = !args.includes('--no-coi') && items.some((i) => i.website) ? await loadCoiList({ dataDir: opt('data', 'data'), log: (m) => console.error(m) }) : undefined;
const { text } = await runWatchlist(items, { coi, name, statePath: opt('state', `state/${name}.json`), outDir: opt('out', 'reports'), isirEnabled: !args.includes('--no-isir'), log: (m) => console.error(m) });
console.log(text);
