// Supplier Watch: Matomo web analytics. Cookieless (no consent banner needed, matches the privacy policy),
// and URLs are cleaned before they leave the browser: manage, confirm and unsubscribe links carry secret tokens.
// Server-rendered pages pass page data in <script type="application/json" id="sw-a">:
//   { userId, title, events: [[category, action, name?, value?]], plansView, notFound }
// Revenue is tracked server side from the Stripe webhook (src/analytics.js), with the same userId.
// Matomo is reached first party through /stats/, which nginx proxies to the Matomo server (see docs/analytics.md).
(function () {
  'use strict';
  var SITE_ID = '9';
  var KEEP = /^(mtm_|utm_|pk_)/; // campaign parameters are the only query string we report
  function clean(href) {
    var u; try { u = new URL(href, location.href); } catch (e) { return ''; }
    if (u.origin !== location.origin) return u.href; // external referrer: Matomo reads search keywords from it
    var q = new URLSearchParams();
    u.searchParams.forEach(function (v, k) { if (KEEP.test(k)) q.append(k, v); });
    var s = q.toString(); return u.origin + u.pathname + (s ? '?' + s : '');
  }
  var data = {};
  var el = document.getElementById('sw-a');
  if (el) try { data = JSON.parse(el.textContent) || {}; } catch (e) { data = {}; }

  var _paq = window._paq = window._paq || [];
  function push() { _paq.push(Array.prototype.slice.call(arguments)); }
  push('setTrackerUrl', '/stats/event');
  push('setSiteId', SITE_ID);
  push('disableCookies');
  push('alwaysUseSendBeacon'); // upgrade clicks leave for Stripe right away
  push('setExcludedQueryParams', ['t', 'client_reference_id', 'prefilled_email']);
  push('setCustomUrl', clean(location.href));
  if (document.referrer) push('setReferrerUrl', clean(document.referrer));
  if (data.userId) push('setUserId', data.userId);
  if (data.notFound) push('setDocumentTitle', '404/URL = ' + encodeURIComponent(location.pathname) + '/From = ' + encodeURIComponent(document.referrer ? clean(document.referrer) : ''));
  else if (data.title) push('setDocumentTitle', data.title);
  if (data.plansView) push('setEcommerceView', false, false, 'Plans');
  push('enableHeartBeatTimer');
  push('enableJSErrorTracking');
  push('trackPageView');
  (data.events || []).forEach(function (e) { push.apply(null, ['trackEvent'].concat(e)); });
  push('enableLinkTracking');
  push('trackVisibleContentImpressions', true, 750);
  var g = document.createElement('script'); g.async = true; g.src = '/stats/script.js';
  document.head.appendChild(g);

  function ev(category, action, name, value) { var e = ['trackEvent', category, action]; if (name != null) e.push(String(name)); if (value != null) e.push(value); _paq.push(e); }
  function filledIcos(form) { return Array.prototype.filter.call(form.querySelectorAll('[name=ico]'), function (i) { return i.value.trim(); }).length; }

  // First-touch attribution for revenue: how this visitor reached the site, stored with the new account at sign-up
  // and sent with its Stripe payments. No cookie or storage: only the current page's referrer and campaign.
  function acquisition() {
    var p = new URLSearchParams(location.search), a = {};
    var c = p.get('mtm_campaign') || p.get('utm_campaign') || p.get('pk_campaign') || p.get('mtm_cid');
    var k = p.get('mtm_kwd') || p.get('utm_term') || p.get('pk_kwd');
    if (c) a.c = c.slice(0, 100);
    if (k) a.k = k.slice(0, 100);
    if (document.referrer) { try { var r = new URL(document.referrer); if (r.origin !== location.origin) a.ref = (r.origin + r.pathname).slice(0, 300); } catch (e) { /* ignore */ } }
    return a;
  }
  document.querySelectorAll('form[action="/signup"]').forEach(function (f) {
    var a = acquisition(); if (!a.c && !a.ref) return;
    var i = document.createElement('input'); i.type = 'hidden'; i.name = 'acq'; i.value = JSON.stringify(a); f.appendChild(i);
  });

  document.addEventListener('submit', function (e) {
    var f = e.target, action = f.getAttribute('action') || '';
    if (action === '/signup') ev('Signup', 'signup-submit', null, filledIcos(f));
    else if (action.indexOf('/manage-link?freecheck=1') === 0) ev('Free check', 'free-check-submit', f.querySelector('[name=web]') && f.querySelector('[name=web]').value.trim() ? 'with website' : 'IČO only');
    else if (action === '/manage-link') ev('Account', 'manage-link-submit');
    else if (action === '/manage') {
      var act = f.querySelector('[name=action]'); act = act ? act.value : 'save';
      if (act === 'billing') ev('Billing', 'billing-portal');
      else if (act === 'save' || act === 'save_client') ev('Suppliers', 'suppliers-save', act === 'save_client' ? 'client list' : 'own list', filledIcos(f));
    }
  }, true);

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a, button');
    if (!a) return;
    var plan = a.getAttribute('data-plan');
    if (plan) { // upgrade CTA: an ecommerce cart, converted by the Stripe webhook's order (or left as an abandoned cart)
      var price = Number(a.getAttribute('data-price')) || 0;
      _paq.push(['clearEcommerceCart']);
      _paq.push(['addEcommerceItem', 'plan-' + plan, a.getAttribute('data-plan-name') || plan, 'Subscription', price, 1]);
      _paq.push(['trackEcommerceCartUpdate', price]);
      ev('Billing', 'upgrade-click', plan, price);
      return;
    }
    var href = a.getAttribute('href') || '';
    if (/[?&]report=/.test(href)) ev('Reports', 'report-download', /[?&]client=/.test(href) ? 'client list' : 'own list');
    else if (a.classList.contains('sw-parse')) ev('Suppliers', 'paste-list');
  }, true);

  document.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('sw-file') && e.target.files && e.target.files.length) ev('Suppliers', 'csv-import');
  }, true);

  document.addEventListener('toggle', function (e) {
    var d = e.target; if (!d.open || d.tagName !== 'DETAILS') return;
    var s = d.querySelector('summary'); if (!s) return;
    ev(d.closest('#faq') ? 'FAQ' : 'Details', 'open', s.textContent.trim().slice(0, 100));
  }, true);
})();
