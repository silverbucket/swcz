// Supplier Watch: structured supplier rows (IČO + optional website). Plain JS, no deps.
(function () {
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
  document.querySelectorAll('.sw-sup').forEach(function (box) {
    var limit = Number(box.getAttribute('data-limit')) || 5;
    var rows = box.querySelector('.sw-rows'), err = box.querySelector('.sw-err'), add = box.querySelector('.sw-add');
    var count = box.querySelector('.sw-count'), paste = box.querySelector('.sw-paste textarea');
    var tpl = rows.querySelector('.sw-row').cloneNode(true);
    tpl.querySelectorAll('input').forEach(function (i) { i.value = ''; i.removeAttribute('value'); });
    function all() { return Array.prototype.slice.call(rows.querySelectorAll('.sw-row')); }
    function filled() { return all().filter(function (r) { return r.querySelector('[name=ico]').value.trim(); }).length; }
    function refresh() {
      var n = all().length;
      add.disabled = n >= limit;
      count.textContent = filled() + ' / ' + limit + (n >= limit ? ' (plan limit)' : '');
    }
    function newRow(ico, web) {
      if (all().length >= limit) return null;
      var r = tpl.cloneNode(true);
      r.querySelector('[name=ico]').value = ico || ''; r.querySelector('[name=web]').value = web || '';
      rows.appendChild(r); refresh(); return r;
    }
    function check(input) {
      var v = input.value.trim(), msg = '';
      if (input.name === 'ico') {
        v = v.replace(/\s/g, ''); input.value = v;
        if (v && !icoOk(v)) msg = 'Invalid IČO: ' + v + ' (8 digits with a valid check digit)';
      } else if (v) {
        var d = domain(v);
        if (d === null) msg = 'Invalid website: ' + v; else input.value = d;
        if (!msg && !input.parentNode.querySelector('[name=ico]').value.trim()) msg = 'Enter the IČO for website ' + d;
      }
      input.classList.toggle('sw-bad', !!msg);
      input.setCustomValidity(msg);
      return msg;
    }
    rows.addEventListener('change', function (e) { if (e.target.name) { err.textContent = check(e.target); refresh(); } });
    rows.addEventListener('click', function (e) {
      if (!e.target.classList.contains('sw-del')) return;
      var r = e.target.closest('.sw-row');
      if (all().length > 1) r.remove(); else r.querySelectorAll('input').forEach(function (i) { i.value = ''; check(i); });
      err.textContent = ''; refresh();
    });
    add.addEventListener('click', function () { var r = newRow(); if (r) r.querySelector('input').focus(); });
    box.querySelector('.sw-parse').addEventListener('click', function () {
      if (window.SWCsv && window.SWCsv.looksLikeCsv(paste.value)) { // a whole pasted export: same parser as file import
        var r = window.SWCsv.parseText(paste.value), have0 = all().map(function (x) { return x.querySelector('[name=ico]').value.trim().padStart(8, '0'); }), over0 = 0;
        r.rows.forEach(function (row) { if (have0.indexOf(row.ico) > -1) return; var el = all().filter(function (x) { return !x.querySelector('[name=ico]').value.trim(); })[0] || newRow(); if (!el) { over0++; return; } el.querySelector('[name=ico]').value = row.ico; el.querySelector('[name=web]').value = row.web || ''; have0.push(row.ico); });
        paste.value = ''; err.textContent = (r.invalid.length ? 'Not recognised: ' + r.invalid.map(function (x) { return x.value; }).join(', ') + '. ' : '') + (over0 ? over0 + ' over your plan limit were skipped.' : ''); refresh(); return;
      }
      var bad = [], over = 0, last = null;
      var have = all().map(function (r) { return r.querySelector('[name=ico]').value.trim().padStart(8, '0'); });
      paste.value.split(/[\s,;]+/).filter(Boolean).forEach(function (t) {
        if (/[a-z]/i.test(t) && t.indexOf('.') > -1) {
          var d = domain(t);
          if (d && last) last.querySelector('[name=web]').value = d; else bad.push(t);
          return;
        }
        var n = t.replace(/\D/g, '');
        if (!n || n.length > 8 || !icoOk(n)) { bad.push(t); last = null; return; }
        n = n.padStart(8, '0');
        if (have.indexOf(n) > -1) { last = null; return; }
        var empty = all().filter(function (r) { return !r.querySelector('[name=ico]').value.trim(); })[0];
        var r = empty || newRow();
        if (!r) { over++; last = null; return; }
        r.querySelector('[name=ico]').value = n; have.push(n); last = r;
      });
      paste.value = '';
      err.textContent = (bad.length ? 'Not recognised: ' + bad.join(', ') + '. ' : '') + (over ? over + ' over your plan limit were skipped.' : '');
      refresh();
    });
    // CSV import (Pohoda, Money S3, Fakturoid or any CSV with an IČO column): preview into the rows.
    var file = box.querySelector('.sw-file'), info = box.querySelector('.sw-csvinfo');
    if (file && window.SWCsv) file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      if (f.size > 2e6) { info.textContent = 'File too large (max 2 MB).'; return; }
      var rd = new FileReader();
      rd.onload = function () {
        var r = window.SWCsv.parseBytes(new Uint8Array(rd.result));
        if (r.error) { info.textContent = r.error; return; }
        var have = all().map(function (x) { return x.querySelector('[name=ico]').value.trim().padStart(8, '0'); });
        var added = 0, over = 0, dupes = r.duplicates;
        r.rows.forEach(function (row) {
          if (have.indexOf(row.ico) > -1) { dupes++; return; }
          var empty = all().filter(function (x) { return !x.querySelector('[name=ico]').value.trim(); })[0];
          var el = empty || newRow(); if (!el) { over++; return; }
          el.querySelector('[name=ico]').value = row.ico; el.querySelector('[name=web]').value = row.web || '';
          if (row.name) el.querySelector('[name=ico]').title = row.name;
          have.push(row.ico); added++;
        });
        info.textContent = 'Detected: ' + (r.format === 'generic' ? 'CSV' : r.format + ' export') + ' (' + r.encoding + ', delimiter "' + r.delimiter + '"). Added ' + added + ' supplier' + (added === 1 ? '' : 's') + ' to the rows below' +
          (over ? '; ' + over + ' over your plan limit were skipped' : '') + (dupes ? '; ' + dupes + ' duplicates skipped' : '') + (r.invalid.length ? '; problems: ' + r.invalid.slice(0, 8).map(function (x) { return 'line ' + x.line + ' ' + x.value + ' (' + x.reason + ')'; }).join(', ') + (r.invalid.length > 8 ? ' and ' + (r.invalid.length - 8) + ' more' : '') : '') + '. Check the rows, then save.';
        file.value = ''; refresh();
      };
      rd.readAsArrayBuffer(f);
    });
    box.closest('form').addEventListener('submit', function (e) {
      var msgs = all().map(function (r) { return [check(r.querySelector('[name=ico]')), check(r.querySelector('[name=web]'))]; })
        .reduce(function (a, b) { return a.concat(b); }, []).filter(Boolean);
      if (!filled() && !(paste.value.trim())) msgs.push('Add at least one supplier IČO.');
      if (msgs.length) { e.preventDefault(); err.textContent = msgs.join(' · '); }
    });
    refresh();
  });
})();
