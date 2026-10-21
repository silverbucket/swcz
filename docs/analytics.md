# Analytics (Matomo)

Matomo site ID 9, ecommerce on, currency CZK. Cookieless: no consent banner, and the privacy policy's
"no tracking cookies" stays true.

## What is tracked

**Browser** (`site/analytics.js`, loaded on every page):

- Page views, time on page (heartbeat), outlinks, JS errors, 404s (`404/URL = …` titles).
- Content impressions on the landing page blocks (Hero, Sample alert, Pricing, Signup form, FAQ, Czech summary)
  and the free check result's "watch this supplier" CTA: how far people get, and what they click.
- Events, by category:

| Category | Actions |
|---|---|
| Signup | `signup-submit` (value: IČO rows filled), `signup-email-sent`, `signup-confirmed`, `signup-error` (name: why) |
| Free check | `free-check-submit`, `free-check` (name: `warnings` / `clean`, value: warning count), `free-check-error` |
| Suppliers | `csv-import`, `paste-list`, `suppliers-save`, `suppliers-saved` (value: kept), `plan-limit-hit` (value: dropped) |
| Billing | `upgrade-click` (name: plan), `billing-portal`, and server side: `subscription-started`, `plan-upgraded`, `plan-downgraded`, `cancel-scheduled`, `cancel-reverted`, `subscription-lapsed`, `subscription-cancelled` |
| Reports | `report-download` |
| Account | `manage-link-submit`, `manage-link-requested`, `account-delete-requested`, `account-kept`, `unsubscribed` |
| API, Clients | `api-key-created`, `client-added` |
| FAQ | `open` (name: the question) |

- **Ecommerce:** the manage page with upgrade options is a "Plans" category view; an upgrade click is a cart
  (plan as product). Carts that never become an order are Matomo's abandoned carts.
- **User ID:** the account id (`acc_…`, pseudonymous) is set on the sign-up result page, the manage pages and
  unsubscribe, so a visitor's visits and payments join up in the visitor profile.

**Server** (`src/analytics.js`, from the Stripe webhook):

- `checkout.session.completed` → ecommerce order (`ec_id` = Checkout session id, revenue in Kč, item
  `plan-<plan>`, category Subscription / New).
- `invoice.paid` with `subscription_cycle` → order (Subscription / Renewal); with `subscription_update` → order
  (Subscription / Plan change). The first invoice is not counted twice.
- Subscription changes → the Billing events above.
- Each order carries the account's **first touch** (campaign, keyword, referring site captured on the sign-up
  form) as Matomo attribution, so revenue by channel and campaign is the channel that brought the customer, not
  the email link they paid from.

**Never sent:** manage / confirm / unsubscribe tokens (URLs are reduced to path + `mtm_*`/`utm_*`/`pk_*`
parameters before anything leaves the browser), email addresses, IČO numbers (free check and client pages get
generic titles), client names.

Product emails carry campaigns: `confirm-email`, `manage-link`, `alert-email`.

## Setup

### 1. nginx: serve Matomo first party under /stats/

The site must not reference the Matomo host, and a first-party path also survives most blockers. In the
supplierwatch.cz server block:

```nginx
location = /stats/script.js {
    proxy_pass https://MATOMO_HOST/matomo.js;
    proxy_set_header Host MATOMO_HOST;
    proxy_ssl_server_name on;
    expires 1d;
}
location = /stats/event {
    proxy_pass https://MATOMO_HOST/matomo.php$is_args$args;
    proxy_set_header Host MATOMO_HOST;
    proxy_ssl_server_name on;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header User-Agent $http_user_agent;
    proxy_set_header Accept-Language $http_accept_language;
}
```

### 2. Matomo: trust the proxy's X-Forwarded-For

Otherwise every visit has the supplierwatch.cz server's IP. In Matomo's `config/config.ini.php`:

```ini
[General]
proxy_client_headers[] = HTTP_X_FORWARDED_FOR
proxy_ips[] = <supplierwatch.cz server IP>
```

`proxy_ips` makes Matomo trust the header only from that server, so other sites on the same Matomo are unaffected.
The privacy policy promises two things to set under Administration → Privacy → Anonymize data: IP anonymisation
of at least 2 bytes, and "Regularly delete old raw data" older than 25 months (750 days) for this site.

### 3. App environment

```
MATOMO_URL=https://MATOMO_HOST   # server-side tracking; unset = off
MATOMO_SITE_ID=9                 # default 9
```

### 4. Stripe webhook

Add `invoice.paid` to the webhook's events (next to `checkout.session.completed` and
`customer.subscription.updated/deleted`) to get renewal revenue.

### 5. Goals

```
MATOMO_URL=https://MATOMO_HOST MATOMO_TOKEN=... node tools/matomo-setup.js
```

Creates the funnel goals (free check → sign-up submitted → email sent → confirmed → plan limit hit → upgrade
clicked → subscription started) and adds the token parameters to the site's excluded query parameters as a
second line of defence. Safe to re-run.

## Reports worth a look

- Goals → each goal by Channel type / Campaign: which sources produce confirmed accounts, not just visits.
- Ecommerce → Sales by Channel / Campaign (first touch), Products (plans), Abandoned carts.
- Visitors → User IDs: one row per account, with its visits and revenue.
- Events → Free check `free-check` by name: share of checks that found warnings.
- Events → FAQ: the questions people open (objections the landing page doesn't answer).
- Behaviour → Contents: impressions vs. interactions for Pricing and the Signup form.

Limits: server-side hits come from the app server, so their location is the server's; the visit and revenue
still join the visitor by User ID. First touch is only seen when the sign-up form is on the landing page of the
visit (it reads the referrer and campaign of the current page; nothing is stored in the browser).
