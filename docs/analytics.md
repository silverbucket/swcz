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
| Suppliers | `csv-import`, `paste-list`, `suppliers-save`, `suppliers-saved` (value: kept), `plan-limit-hit` (name: plan on save, or `paste` / `csv import` when the form skipped rows; value: suppliers over the limit) |
| Billing | `upgrade-click` (name: plan), `billing-portal`, and server side: `subscription-started`, `plan-upgraded`, `plan-downgraded`, `cancel-scheduled`, `cancel-reverted`, `subscription-lapsed`, `subscription-cancelled` |
| Reports | `report-download` |
| Account | `manage-link-submit`, `manage-link-requested`, `account-delete-requested`, `account-kept`, `unsubscribed`, `paused-page` (a sign-up, manage or billing page answered "paused") |
| Updates | `updates-submit`, `updates-email-sent`, `updates-confirmed` (name: `updates form` / `sign-up`), `updates-error` (name: why), `updates-unsubscribed` |
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
- Each order carries the account's **first touch** as Matomo attribution, so revenue by channel and campaign is
  the channel that brought the customer, not the email link they paid from. Before an account's first order the
  server asks Matomo's Live API for the earliest visit with its User ID (the visit it signed up in, which Matomo
  joins from the landing page on, e.g. Google → guide → sign-up), and saves the answer on the account. If that
  lookup can't answer, the referrer and campaign the sign-up form saw are used.

**Never sent:** manage / confirm / unsubscribe tokens, updates list tokens (`u`) (URLs are reduced to path + `mtm_*`/`utm_*`/`pk_*`
parameters before anything leaves the browser), email addresses, IČO numbers (free check and client pages get
generic titles), client names.

Product emails carry campaigns: `confirm-email`, `manage-link`, `alert-email`.

## Setup

### 1. Matomo privacy settings

The privacy policy promises two things to set under Administration → Privacy → Anonymize data: IP anonymisation
of at least 2 bytes, and "Regularly delete old raw data" older than 25 months (750 days) for this site.

### 2. App environment

```
MATOMO_URL=https://matomo.silverbucket.net   # server-side tracking; unset = off
MATOMO_SITE_ID=9                 # default 9
MATOMO_TOKEN=...                 # view access to site 9, for the first-touch lookup; unset = sign-up form only
```

Create the token for a Matomo user that has only *view* access to site 9 (not the admin token used for the setup
script below).

### 3. Stripe webhook

Add `invoice.paid` to the webhook's events (next to `checkout.session.completed` and
`customer.subscription.updated/deleted`) to get renewal revenue.

### 4. Goals

```
MATOMO_URL=https://matomo.silverbucket.net MATOMO_TOKEN=... node tools/matomo-setup.js
```

Creates the funnel goals (free check → sign-up submitted → email sent → confirmed → plan limit hit → upgrade
clicked → subscription started; and, for while sign-ups are paused, updates submitted → updates confirmed) and adds the token parameters to the site's excluded query parameters as a
second line of defence. Safe to re-run.

## Reports worth a look

While sign-ups are paused (`SIGNUPS_ENABLED=false`) the funnel is free check → updates submitted → updates
confirmed; the Billing and Signup events stop, and `paused-page` shows who still arrives at the paused pages
(old links, bookmarks).

- Goals → each goal by Channel type / Campaign: which sources produce confirmed accounts, not just visits.
- Ecommerce → Sales by Channel / Campaign (first touch), Products (plans), Abandoned carts.
- Visitors → User IDs: one row per account, with its visits and revenue.
- Events → Free check `free-check` by name: share of checks that found warnings.
- Events → FAQ: the questions people open (objections the landing page doesn't answer).
- Behaviour → Contents: impressions vs. interactions for Pricing and the Signup form.

Limits: server-side hits come from the app server, so their location is the server's; the visit and revenue
still join the visitor by User ID. First touch covers one visit: someone who came from Google on Monday and typed
the address on Wednesday to sign up counts as direct, because without cookies those are two unrelated visits.
