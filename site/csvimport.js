// Supplier Watch CSV import: generic CSV plus common Czech accounting exports (Pohoda, Money S3, Fakturoid).
// Works in the browser (window.SWCsv) and in Node (globalThis.SWCsv after import), so the server validates with the same code.
(function (g) {
  'use strict';
  function icoOk(s) {
    if (!/^\d{1,8}$/.test(s)) return false;
    var d = s.padStart(8, '0'), sum = 0;
    for (var i = 0; i < 7; i++) sum += Number(d[i]) * (8 - i);
    return (11 - (sum % 11)) % 10 === Number(d[7]);
  }
  function domain(s) {
    var d = String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
    d = d.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
    if (!d) return '';
    try { d = new URL('http://' + d).hostname.replace(/^www\./, ''); } catch (e) { return null; }
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(d) ? d : null;
  }
  /** Bytes -> text. UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1250 (Czech Excel/Pohoda/Money default). */
  function decodeBytes(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] === 0xFF && b[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16LE' };
    if (b[0] === 0xFE && b[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16BE' };
    var bom = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bom ? b.subarray(3) : b), encoding: bom ? 'UTF-8 (BOM)' : 'UTF-8' }; }
    catch (e) { return { text: new TextDecoder('windows-1250').decode(b), encoding: 'Windows-1250' }; }
  }
  function sniffDelimiter(text) {
    var first = text.split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '';
    var best = ',', n = -1;
    [';', ',', '\t', '|'].forEach(function (d) { var c = 0, q = false; for (var i = 0; i < first.length; i++) { var ch = first[i]; if (ch === '"') q = !q; else if (ch === d && !q) c++; } if (c > n) { n = c; best = d; } });
    return n > 0 ? best : ';';
  }
  /** RFC 4180 parser (quotes, doubled quotes, newlines inside quotes). */
  function parseRows(text, delim) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return c.trim(); }); }).filter(function (r) { return r.some(function (c) { return c; }); });
  }
  function norm(h) { return String(h || '').replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[._:]+$/, '').replace(/[\s_.]+/g, ' ').trim(); }
  // Header names as they appear in exports (normalised: lower case, no diacritics).
  var ICO_H = ['ico', 'ic', 'registration no', 'registrationno', 'company id', 'company number', 'identifikacni cislo', 'ic subjektu', 'ic firmy', 'ico firmy', 'icdodavatele', 'ic dodavatele', 'ico dodavatele', 'reg no'];
  var WEB_H = ['web', 'www', 'website', 'web site', 'url', 'internet', 'www stranky', 'webove stranky', 'webova stranka', 'web page', 'homepage', 'e-shop', 'eshop'];
  var NAME_H = ['firma', 'nazev', 'nazev firmy', 'name', 'obchodni jmeno', 'company', 'company name', 'dodavatel', 'jmeno'];
  function findCol(header, names) { for (var k = 0; k < names.length; k++) { var i = header.indexOf(names[k]); if (i > -1) return i; } return -1; }
  function detectFormat(h) {
    if (h.indexOf('registration no') > -1 && (h.indexOf('vat no') > -1 || h.indexOf('name') > -1)) return 'Fakturoid';
    if (h.indexOf('ic') > -1 && h.indexOf('firma') > -1) return 'Pohoda';
    if (h.indexOf('ico') > -1 && (h.indexOf('nazev') > -1 || h.indexOf('nazev firmy') > -1 || h.indexOf('kod partnera') > -1 || h.indexOf('kod') > -1)) return 'Money S3';
    return 'generic';
  }
  function cleanIco(v) { var s = String(v || '').replace(/\s|\u00a0/g, '').replace(/\.0+$/, '').replace(/^="?|"$/g, ''); if (/^CZ/i.test(s)) return null; return /^\d{1,8}$/.test(s) ? s.padStart(8, '0') : null; }
  /**
   * Parse CSV text. Returns { format, delimiter, header, rows: [{ ico, web, name, line }], invalid: [{ line, value, reason }], duplicates, error }.
   */
  function parseText(text, opts) {
    opts = opts || {};
    text = String(text || '').replace(/^\uFEFF/, '');
    var delim = opts.delimiter || sniffDelimiter(text);
    var all = parseRows(text, delim);
    if (!all.length) return { format: 'generic', delimiter: delim, rows: [], invalid: [], duplicates: 0, error: 'The file is empty.' };
    var header = all[0].map(norm), start = 1;
    var ci = findCol(header, ICO_H), wi = findCol(header, WEB_H), ni = findCol(header, NAME_H);
    var format = detectFormat(header);
    if (ci < 0) {
      // No recognised header: if the first row already has a valid IČO, treat the file as header-less.
      var guess = all[0].findIndex(function (c) { var x = cleanIco(c); return x && icoOk(x); });
      if (guess < 0) return { format: format, delimiter: delim, header: all[0], rows: [], invalid: [], duplicates: 0, error: 'No IČO column found. Name a column "IČO" (or "IČ", "registration_no").' };
      ci = guess; start = 0; format = 'generic'; header = null;
      wi = all[0].findIndex(function (c, i) { return i !== ci && /[a-z]/i.test(c) && c.indexOf('.') > -1 && domain(c); });
    }
    var rows = [], invalid = [], seen = {}, dup = 0;
    for (var r = start; r < all.length; r++) {
      var cells = all[r], raw = cells[ci] || '', line = r + 1;
      if (!raw && !(wi > -1 && cells[wi])) continue;
      if (!raw) { continue; } // contacts without IČO (e.g. foreign or private persons) are skipped silently
      var ico = cleanIco(raw);
      if (!ico || !icoOk(ico)) { invalid.push({ line: line, value: raw, reason: 'invalid IČO' }); continue; }
      if (seen[ico]) { dup++; continue; }
      seen[ico] = 1;
      var web = '';
      if (wi > -1 && cells[wi]) { var d = domain(cells[wi]); if (d) web = d; else invalid.push({ line: line, value: cells[wi], reason: 'invalid website (row kept without it)' }); }
      rows.push({ ico: ico, web: web, name: ni > -1 ? (cells[ni] || '') : '', line: line });
    }
    return { format: format, delimiter: delim === '\t' ? 'tab' : delim, header: header ? all[0] : null, rows: rows, invalid: invalid, duplicates: dup };
  }
  function parseBytes(bytes, opts) { var d = decodeBytes(bytes); var r = parseText(d.text, opts); r.encoding = d.encoding; return r; }
  /** True if a pasted text looks like a CSV with a recognised IČO header (so the paste box can take a whole export). */
  function looksLikeCsv(text) { var first = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)[0] || ''; var d = sniffDelimiter(first); var h = parseRows(first, d)[0] || []; return h.length > 1 && findCol(h.map(norm), ICO_H) > -1; }
  g.SWCsv = { decodeBytes: decodeBytes, parseText: parseText, parseBytes: parseBytes, looksLikeCsv: looksLikeCsv, sniffDelimiter: sniffDelimiter, icoOk: icoOk, domain: domain };
})(typeof window !== 'undefined' ? window : globalThis);
