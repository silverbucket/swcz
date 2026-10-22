#!/usr/bin/env python3
"""Generates site/guides/*.html, site/sitemap.xml and site/robots.txt. Run: python3 tools/build_guides.py"""
import os, datetime
ROOT = os.path.join(os.path.dirname(__file__), '..', 'site')
BASE = 'https://supplierwatch.cz'
UPDATED = '21 October 2026'
CSS = """:root{--ink:#14202b;--muted:#5b6875;--line:#e3e8ee;--bg:#f6f8fa;--brand:#0a7c5a}
*{box-sizing:border-box}body{margin:0;font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink)}
a{color:var(--brand)}.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line)}header.top .wrap{display:flex;justify-content:space-between;align-items:center;height:60px;max-width:1040px}
.logo{font-weight:700;color:var(--ink);text-decoration:none}.logo span{color:var(--brand)}.top nav a{color:var(--muted);text-decoration:none;margin-left:18px;font-size:15px}
h1{font-size:clamp(28px,4vw,40px);line-height:1.15;margin:40px 0 12px}h2{margin:36px 0 10px;font-size:24px}h3{margin:24px 0 6px}
.meta,.muted{color:var(--muted);font-size:15px}.box{background:var(--bg);border-radius:12px;padding:18px 22px;margin:24px 0}
.cta{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:16px}td,th{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
footer{border-top:1px solid var(--line);margin-top:56px;padding:28px 0;color:var(--muted);font-size:15px}footer a{color:var(--muted);margin-right:16px}
pre{background:#f1f3f5;border-radius:8px;padding:12px 14px;overflow:auto;font-size:14px;line-height:1.45}code{background:#f1f3f5;padding:1px 4px;border-radius:3px;font-size:.92em}pre code{padding:0;background:none}
.ok{color:#0a7c5a;font-weight:600}.bad{color:#b4441f;font-weight:600}
@media (max-width:760px){.top nav{display:none}}"""
DISCLAIMER = '<p class="box muted"><strong>Not legal or tax advice.</strong> This guide is general information about public Czech registers and the law as we understand it on the date shown. Laws and court practice change; for a decision about a specific transaction, ask a Czech tax adviser (daňový poradce) or lawyer.</p>'
CTA = '<div class="box"><p><strong>Check a supplier now, free:</strong> enter an IČO and see its VAT status, published bank accounts, insolvency record and register entry in one go.</p><p><a class="cta" href="/check.html">Check one IČO</a><!--if monitoring--> &nbsp; or <a href="/#signup">get daily alerts for up to 5 suppliers free</a><!--end--></p></div>'

GUIDES = []
def guide(slug, title, desc, body, short):
    GUIDES.append(dict(slug=slug, title=title, desc=desc, body=body, short=short))

def page(path, title, desc, body, canonical, more=True, script=''):
    nav = ''.join(f'<li><a href="/guides/{g["slug"]}.html">{g["short"]}</a></li>' for g in GUIDES)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} | Supplier Watch CZ</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{BASE}{canonical}">
<style>{CSS}</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="logo" href="/">Supplier Watch <span>CZ</span></a><nav><a href="/#checks">What we check</a><a href="/guides/">Guides</a><a href="/check.html">Free IČO check</a><!--if monitoring--><a href="/#pricing">Pricing</a><!--end--></nav></div></header>
<main class="wrap">
{body}
{('<h2>More guides</h2><ul>' + nav + '</ul>') if more else ''}
</main>
<footer><div class="wrap">
<a href="/">Home</a><a href="/guides/">Guides</a><a href="/check.html">Free IČO check</a><a href="/about.html">About</a><a href="/sources.html">Data sources</a><!--if monitoring--><a href="/api.html">API</a><!--end--><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="mailto:contact@supplierwatch.cz">contact@supplierwatch.cz</a>
<p style="margin:12px 0 0">Supplier Watch CZ is an independent service. It is not affiliated with the Czech Financial Administration, the Ministry of Justice or ČOI.</p>
</div></footer>
{script}<script src="/analytics.js" defer></script>
</body>
</html>
"""

# ---------- Guide 1 ----------
guide('czech-vat-liability-unreliable-payer-bank-accounts',
 'Czech VAT liability for your supplier\'s unpaid VAT (§109): unreliable payers and unpublished bank accounts',
 'When a Czech VAT payer can be made to pay its supplier\'s unpaid VAT under §109 of the VAT Act: unreliable payers, payments to unpublished bank accounts, cash and crypto, and how to protect yourself.',
 f"""<h1>Czech VAT liability for your supplier's unpaid VAT (§109)</h1>
<p class="meta">Updated {UPDATED} · about 6 minutes</p>
<p>In the Czech Republic a VAT payer that buys from another Czech VAT payer can become <strong>guarantor (ručitel)</strong> for the VAT that the supplier fails to pay. The tax office can then ask the buyer to pay that VAT a second time. The rules are in <strong>§109 of Act No. 235/2004 Sb., on value added tax (ZDPH)</strong>. This guide explains the situations that trigger it and the simple checks that reduce the risk.</p>

<h2>Who this applies to</h2>
<p>§109 applies to a <strong>VAT payer (plátce DPH)</strong> that receives a taxable supply with place of supply in the Czech Republic from another VAT payer, or pays for one. That includes foreign companies that are registered for Czech VAT. If you are not registered for Czech VAT, see our <a href="/guides/doing-business-with-czech-suppliers.html">guide for foreign companies</a>.</p>

<h2>The general rule: "knew or should have known"</h2>
<p>Under §109(1) the buyer is liable for the supplier's unpaid VAT if, when the tax became due, it knew or should and could have known that the VAT would intentionally not be paid. §109(2) then lists situations in which the law <em>presumes</em> that the buyer knew. These presumptions are what matters day to day.</p>

<h2>Situations where knowledge is presumed (§109(2), as in force from 1 January 2025)</h2>
<table>
<tr><th>Situation</th><th>What to check</th></tr>
<tr><td>The supplier is <strong>published as an unreliable VAT payer</strong> (nespolehlivý plátce)</td><td>The supplier's status in the VAT register on the date of supply and on the date you pay</td></tr>
<tr><td>The supply is between related persons under §36a(3)</td><td>Your own group structure</td></tr>
<tr><td>The price is, without economic reason, obviously different from the usual price</td><td>Your pricing documentation</td></tr>
<tr><td>You pay, wholly or partly, by bank transfer to an <strong>account that the tax administrator has not published</strong> for that supplier</td><td>The supplier's published accounts in the VAT register, before every payment</td></tr>
<tr><td>You pay, wholly or partly, in a <strong>virtual asset</strong> (cryptocurrency)</td><td>Do not pay VAT-able invoices in crypto</td></tr>
<tr><td>You pay in <strong>cash above the limit</strong> set by the Act on limitation of cash payments (No. 254/2004 Sb.)</td><td>The cash limit; the Financial Administration states it as 270,000 Kč</td></tr>
</table>

<h3>No minimum amount for unpublished bank accounts since 2025</h3>
<p>Older guides say the unpublished-account rule only applies to payments above twice the cash-payment limit (700,000 Kč, later 540,000 Kč). <strong>That threshold no longer applies.</strong> The text of §109(2)(c)(2) in force since 1 January 2025 contains no amount: any bank transfer, wholly or partly, to an account that is not published for the supplier triggers the presumption. In practice this means checking the account for every payment, including small ones. Accounts held abroad are not published in the Czech register, so payments to them fall under the same rule.</p>

<h2>What the courts have said</h2>
<p>Both decisions below concern the unreliable-payer rule <em>before</em> the 2025 amendment, when it sat in §109(3), and they pull in different directions:</p>
<ul>
<li><strong>Supreme Administrative Court, 5 Afs 60/2021 (2022):</strong> a VAT payer that received a supply from a supplier listed as an unreliable payer was liable for the supplier's unpaid VAT, and "no further condition" had to be met for the liability to arise. <a href="https://rozhodnuti.usucapio.com/nss/5-afs-60-2021-34" rel="noopener">Decision text</a></li>
<li><strong>Supreme Administrative Court, 3 Afs 114/2018 (2021):</strong> the court annulled a guarantor assessment and held that, under EU law, the published unreliable status alone should not automatically make the buyer liable; the circumstances of the case had to be assessed. <a href="https://rozhodnuti.usucapio.com/nss/3-afs-114-2018-87" rel="noopener">Decision text</a></li>
</ul>
<p>Since 2025 the law itself frames the unreliable status as a presumption of knowledge. Either way, the outcome depends on facts the buyer can control: whether it checked the supplier and when. A dated record of your checks is useful evidence.</p>

<h2>How to protect yourself</h2>
<ol>
<li><strong>Check the supplier's status before each supply and each payment</strong> in the VAT register (see <a href="/guides/how-to-check-a-czech-supplier.html">how to check a Czech supplier</a>).</li>
<li><strong>Pay only to an account published for that supplier.</strong> If the invoice shows a different account, ask the supplier to publish it first.</li>
<li><strong>Use the special method of securing tax (§109a ZDPH)</strong> if you have doubts: you may pay the VAT amount directly to the supplier's tax office instead of to the supplier, and the supplier receives only the price without VAT.</li>
<li><strong>Keep evidence</strong> of each check (date, result).<!--if monitoring--> Supplier Watch keeps a daily log for every supplier you watch.<!--end--></li>
</ol>
{CTA}
<h2>Official sources</h2>
<ul>
<li>Financial Administration: <a href="https://financnisprava.gov.cz/en/taxes/tax-obligations/value-added-tax/unreliable-vat-payer/information-on-an-unreliable-vat-payer-in-the-czech-republic" rel="noopener">Information on an unreliable VAT payer (English)</a></li>
<li>Financial Administration: <a href="https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/informace-stanoviska-a-sdeleni/ruceni/ruceni-za-nezaplacenou-dph-a-bankovni-ucty" rel="noopener">Ručení za nezaplacenou DPH a bankovní účty</a> (cash limit 270,000 Kč)</li>
<li>Act No. 235/2004 Sb., §109 and §109a: <a href="https://www.zakonyprolidi.cz/cs/2004-235#p109" rel="noopener">current text (Czech)</a></li>
</ul>
{DISCLAIMER}""", 'VAT liability (§109)')

# ---------- Guide 2 ----------
guide('how-to-check-a-czech-supplier',
 'How to check a Czech supplier: ARES, the VAT register, the insolvency register (ISIR) and ČOI',
 'Step-by-step guide to checking a Czech company by IČO in the free official registers: ARES, the VAT register (unreliable payer and bank accounts), the insolvency register ISIR and the ČOI risky e-shop list.',
 f"""<h1>How to check a Czech supplier</h1>
<p class="meta">Updated {UPDATED} · about 5 minutes</p>
<p>Every Czech business has an 8-digit identification number, the <strong>IČO</strong>. With it you can check a supplier for free in four official sources. Here is what each one tells you and where to find it.</p>

<h2>1. ARES: does the company exist, and is it still active?</h2>
<p><a href="https://ares.gov.cz/" rel="noopener">ARES</a> (Administrativní registr ekonomických subjektů) is the Ministry of Finance's search across the Czech public registers. Search by IČO or name and look at:</p>
<ul>
<li>the exact <strong>legal name</strong> and <strong>registered address (sídlo)</strong>, and whether they match the invoice;</li>
<li>the <strong>VAT ID (DIČ)</strong>, usually "CZ" followed by the IČO for companies;</li>
<li>whether the company has a <strong>date of dissolution</strong> or "v likvidaci" (in liquidation) in its name;</li>
<li>links to the Commercial Register entry (<a href="https://or.justice.cz/" rel="noopener">or.justice.cz</a>), where you find directors and filed documents such as annual accounts.</li>
</ul>

<h2>2. The VAT register: unreliable payer status and published bank accounts</h2>
<p>The Financial Administration's <a href="https://adisspr.mfcr.cz/dpr/DphReg" rel="noopener">register of VAT payers</a> shows, for a DIČ:</p>
<ul>
<li>whether the company is a <strong>VAT payer</strong>;</li>
<li>whether it is published as an <strong>unreliable VAT payer</strong> (nespolehlivý plátce) or an <strong>unreliable person</strong> (nespolehlivá osoba), and since when;</li>
<li>the list of <strong>bank accounts it has published</strong>.</li>
</ul>
<p>These two items decide whether you can become liable for the supplier's VAT. Read <a href="/guides/czech-vat-liability-unreliable-payer-bank-accounts.html">our §109 guide</a> for the rules. Check before each payment, because the status and the account list can change at any time.</p>

<h2>3. ISIR: is the company in insolvency?</h2>
<p>The <a href="https://isir.justice.cz/" rel="noopener">insolvency register (ISIR)</a> of the Ministry of Justice lists insolvency proceedings. Search by IČO. A filed insolvency petition does not always mean the company is bankrupt, but it is a strong reason to stop paying advances and to review open orders.</p>

<h2>4. ČOI: is the supplier's e-shop on the risky websites list?</h2>
<p>If you buy from a Czech online shop, check the <a href="https://www.coi.gov.cz/pro-spotrebitele/rizikove-e-shopy/" rel="noopener">Czech Trade Inspection Authority (ČOI) list of risky e-shops</a>. ČOI lists websites it has received many complaints about or that it could not contact. It is aimed at consumers, but a listing is also a warning sign for a business buyer.</p>

<h2>A quick checklist</h2>
<table>
<tr><th>Check</th><th>Where</th><th>When</th></tr>
<tr><td>Name, address, not dissolved</td><td>ARES</td><td>Before the first order</td></tr>
<tr><td>VAT payer, not unreliable</td><td>VAT register</td><td>Before each supply and payment</td></tr>
<tr><td>Bank account on the invoice is published</td><td>VAT register</td><td>Before each payment</td></tr>
<tr><td>No insolvency proceeding</td><td>ISIR</td><td>Before advances and large orders</td></tr>
<tr><td>Website not on the risky list</td><td>ČOI</td><td>Before ordering from an e-shop</td></tr>
</table>

<h2>Doing it automatically</h2>
<p>Checking by hand works for one supplier. For a list of suppliers, the hard part is noticing when something changes.<!--if monitoring--> Supplier Watch runs all of these checks every morning and emails you only when a status, an address, a bank account or an insolvency record changes. Free for up to 5 suppliers.<!--end--><!--if paused--> The <a href="/check.html">free Supplier Watch check</a> runs all of these checks for one IČO in one go; ongoing monitoring is paused for now (<a href="/#updates">get updates</a>).<!--end--></p>
{CTA}
{DISCLAIMER}""", 'How to check a supplier')

# ---------- Guide 3 ----------
guide('doing-business-with-czech-suppliers',
 'Doing business with Czech suppliers: a guide for foreign companies',
 'What foreign companies should know before buying from Czech suppliers: IČO and DIČ, checking VAT numbers in VIES, when the Czech §109 VAT liability applies to you, bank accounts and insolvency checks.',
 f"""<h1>Doing business with Czech suppliers: a guide for foreign companies</h1>
<p class="meta">Updated {UPDATED} · about 6 minutes</p>
<p>The Czech Republic has open, free public registers, so checking a new supplier is quick once you know the local terms. This guide covers what a foreign buyer should know.</p>

<h2>Key terms</h2>
<table>
<tr><th>Term</th><th>Meaning</th></tr>
<tr><td><strong>IČO</strong></td><td>Company identification number, 8 digits with a check digit. The main key for every register.</td></tr>
<tr><td><strong>DIČ</strong></td><td>Tax / VAT identification number, "CZ" plus digits. For companies it is usually CZ + IČO.</td></tr>
<tr><td><strong>s.r.o. / a.s.</strong></td><td>Limited liability company / joint-stock company.</td></tr>
<tr><td><strong>Plátce DPH</strong></td><td>VAT payer (registered for Czech VAT).</td></tr>
<tr><td><strong>Nespolehlivý plátce</strong></td><td>Unreliable VAT payer, published by the tax administration.</td></tr>
<tr><td><strong>Sídlo</strong></td><td>Registered office.</td></tr>
</table>

<h2>Step 1: confirm the company and its VAT number</h2>
<ul>
<li>Look the company up in <a href="https://ares.gov.cz/" rel="noopener">ARES</a> by IČO and compare the name and address with the contract and invoices.</li>
<li>For cross-border supplies within the EU, confirm the supplier's VAT number in the European Commission's <a href="https://ec.europa.eu/taxation_customs/vies/" rel="noopener">VIES</a> service. VIES shows whether a VAT number is valid for intra-EU trade.</li>
</ul>

<h2>Step 2: does the Czech §109 VAT liability apply to you?</h2>
<p>The Czech rules that make a buyer liable for its supplier's unpaid VAT (<a href="/guides/czech-vat-liability-unreliable-payer-bank-accounts.html">§109 ZDPH</a>) apply to buyers that are <strong>Czech VAT payers</strong> receiving taxable supplies with place of supply in the Czech Republic. That typically covers:</p>
<ul>
<li>foreign companies <strong>registered for Czech VAT</strong> (for example because they hold stock, run projects or sell locally in the Czech Republic);</li>
<li>Czech subsidiaries and branches of foreign groups.</li>
</ul>
<p>If your company is not registered for Czech VAT and buys goods that are shipped to another EU country, the supply is normally an intra-EU supply, and §109 is generally not the issue. You still have the commercial risks below. Your tax adviser can confirm which case you are in.</p>
<p>If §109 does apply: check the unreliable-payer status, and pay only to bank accounts that the supplier has published in the Czech VAT register. Since 1 January 2025 there is no minimum amount for the bank-account rule, and accounts abroad are not published in the Czech register.</p>

<h2>Step 3: check financial health</h2>
<ul>
<li>Search the <a href="https://isir.justice.cz/" rel="noopener">insolvency register ISIR</a> by IČO before paying advances.</li>
<li>Look at filed annual accounts in the collection of documents (sbírka listin) at <a href="https://or.justice.cz/" rel="noopener">or.justice.cz</a>. Many small companies file late, which is itself a signal.</li>
<li>For e-shops, check the <a href="https://www.coi.gov.cz/pro-spotrebitele/rizikove-e-shopy/" rel="noopener">ČOI risky e-shop list</a>.</li>
</ul>

<h2>Step 4: keep watching</h2>
<p>A supplier that is fine today can become an unreliable payer or file for insolvency next month. Re-check regularly, or let a monitoring service do it.<!--if monitoring--> Supplier Watch checks Czech suppliers every morning and sends alerts in English, only when something changes.<!--end--> See <a href="/guides/how-to-check-a-czech-supplier.html">how to check a Czech supplier</a> for each register in detail.</p>
{CTA}
{DISCLAIMER}""", 'Guide for foreign companies')

def write(rel, text):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(text)

for g in GUIDES:
    write(f'guides/{g["slug"]}.html', page(g['slug'], g['title'], g['desc'].replace('"', '&quot;'), g['body'], f'/guides/{g["slug"]}.html'))
idx = '<h1>Guides: checking Czech suppliers</h1><p>Plain-English guides to the Czech registers and the VAT rules that affect buyers.</p>' + ''.join(
    f'<h2><a href="/guides/{g["slug"]}.html">{g["title"]}</a></h2><p>{g["desc"]}</p>' for g in GUIDES) + CTA + DISCLAIMER
write('guides/index.html', page('', 'Guides: checking Czech suppliers', 'Plain-English guides to Czech supplier checks: §109 VAT liability, ARES, the VAT register, ISIR, ČOI, and doing business with Czech suppliers as a foreign company.', idx, '/guides/'))

# ---------- Trust pages (About, Sources, API) ----------
ABOUT = """<h1>About Supplier Watch</h1>
<!--if monitoring--><p>Supplier Watch CZ checks Czech suppliers every morning in the official public registers and emails you, in English with the Czech wording alongside, only when something changes. Each month you also get a PDF report of every check, which you can keep as evidence that you checked your suppliers.</p><!--end--><!--if paused--><p>Supplier Watch CZ checks Czech suppliers in the official public registers, in English with the Czech wording alongside. The <a href="/check.html">free one-off check</a> is available; ongoing daily monitoring is currently paused.</p><!--end-->
<h2>Who runs it</h2>
<table>
<tr><th>Operator</th><td>Nicholas Kossow Jennings, sole trader (fyzická osoba podnikající)</td></tr>
<tr><th>IČO</th><td>28948491 (<a href="https://ares.gov.cz/ekonomicke-subjekty?ico=28948491" rel="noopener">see the ARES record</a>)</td></tr>
<tr><th>Address</th><td>Maliřska 10, 170 00 Praha 7, Czech Republic</td></tr>
<tr><th>Contact</th><td><a href="mailto:contact@supplierwatch.cz">contact@supplierwatch.cz</a></td></tr>
<tr><th>VAT</th><td>Not a VAT payer (neplátce DPH), so prices are final</td></tr>
</table>
<p>Supplier Watch is a small independent service built and run in Prague. It is not affiliated with, or endorsed by, the Ministry of Finance, the Financial Administration, the Ministry of Justice or the Czech Trade Inspection Authority (ČOI).</p>
<h2>Why it exists</h2>
<p>Under §109 of the Czech VAT Act a buyer can be made to pay a supplier's unpaid VAT if the supplier was published as an unreliable payer, or if the buyer paid to a bank account the supplier hadn't published. The registers are public and free, but checking them by hand for every supplier, every time, is easy to forget, and most tools are in Czech only. Supplier Watch does the checks automatically and keeps a record.</p>
<h2>How we work</h2>
<ul>
<li><strong>Official sources only.</strong> Every result comes from a public register; see <a href="/sources.html">data sources</a>.</li>
<li><strong>No false all-clears.</strong> A daily self-check tests every source. If a register is down or changes its format, the affected check is marked "not checked" in your alerts and report, never "OK".</li>
<li><strong>Minimal data.</strong> We store your email, your supplier list and the check results. No tracking cookies, no ads. See the <a href="/privacy.html">privacy policy</a>.</li>
<li><strong>Information, not advice.</strong> Results show what the registers said when we checked; they are not legal or tax advice.</li>
</ul>
<p><!--if monitoring--><a class="cta" href="/#signup">Start free with 5 suppliers</a><!--end--><!--if paused--><a class="cta" href="/check.html">Check a supplier free</a><!--end--></p>"""

SOURCES = """<h1>Data sources</h1>
<p>Supplier Watch uses only official public sources. For each one: who publishes it, what we use it for, and the terms we use it under. We check every source each morning before the customer checks (see <a href="#status">current status</a>).</p>
<h2>1. VAT register (Registr plátců DPH)</h2>
<p><strong>Published by:</strong> the Financial Administration of the Czech Republic (Finanční správa). <strong>We use:</strong> the public web service for third-party software (rozhraní CRPDPH): whether a supplier is published as an unreliable VAT payer (§106a VAT Act) and which bank accounts it has published (§98). <strong>Terms:</strong> public data published by law for exactly this purpose; free to use. <a href="https://adisspr.mfcr.cz/dpr/DphReg" rel="noopener">Look up a supplier yourself</a>.</p>
<h2>2. ARES (business register data)</h2>
<p><strong>Published by:</strong> the Ministry of Finance. <strong>We use:</strong> the ARES REST API for the company name, registered address, legal form, dissolution and liquidation, and the public-register (veřejný rejstřík) record for the statutory body and owners. For directors and owners we store only a short fingerprint to detect changes, not the names. <strong>Terms:</strong> ARES data are public and published as open data; free to use. <a href="https://ares.gov.cz/" rel="noopener">ares.gov.cz</a>, details of companies at <a href="https://or.justice.cz/" rel="noopener">or.justice.cz</a>.</p>
<h2>3. Insolvency register (ISIR)</h2>
<p><strong>Published by:</strong> the Ministry of Justice. <strong>We use:</strong> the public ISIR web service to find insolvency proceedings by IČO, with the case number, state and a link to the case. We never store birth dates, personal ID numbers or home addresses. <strong>Terms:</strong> the register is public by law (§419 Insolvency Act); free to use within the service's limits (50 requests a minute). <a href="https://isir.justice.cz/" rel="noopener">isir.justice.cz</a>.</p>
<h2>4. ČOI list of risky e-shops</h2>
<p><strong>Published by:</strong> the Czech Trade Inspection Authority (Česká obchodní inspekce, ČOI) as open data. <strong>We use:</strong> the daily CSV of risky websites, matched against the supplier websites you enter. <strong>Terms:</strong> ČOI open-data licence, which allows commercial use with attribution and without implying endorsement: <a href="https://coi.gov.cz/pro-spotrebitele/otevrena-data/licence-otevrenych-dat/" rel="noopener">licence</a>. Zdroj: Česká obchodní inspekce. Supplier Watch is not affiliated with or endorsed by ČOI. <a href="https://www.coi.gov.cz/pro-spotrebitele/rizikove-e-shopy/" rel="noopener">The list on coi.gov.cz</a>.</p>
<h2 id="status">Current status</h2>
<p>Result of the latest daily self-check of each source:</p>
<div id="sw-status" class="box"><p class="muted">Loading…</p></div>
<p class="muted">Machine-readable: <a href="/healthz?detail=1">/healthz?detail=1</a>.</p>"""

STATUS_JS = """<script>
(function(){var el=document.getElementById('sw-status');var N={ares:'ARES',vat:'VAT register',isir:'ISIR',coi:'ČOI risky e-shops'};
fetch('/healthz?detail=1').then(function(r){return r.json()}).then(function(j){var s=j.sources;if(!s){el.innerHTML='<p class="muted">No self-check has run yet.</p>';return;}
var t=new Date(s.checkedAt).toLocaleString('en-GB',{timeZone:'Europe/Prague'});var h='<p>Checked '+t+' (Prague time)</p><ul>';
Object.keys(N).forEach(function(k){var d=s.detail&&s.detail[k];if(!d)return;h+='<li>'+N[k]+': '+(d.disabled?'<span class="muted">not used</span>':d.ok?'<span class="ok">OK</span>':'<span class="bad">FAILED</span> (affected checks are marked "not checked" today)')+'</li>';});
el.innerHTML=h+'</ul>';}).catch(function(){el.innerHTML='<p class="muted">Status unavailable.</p>';});})();
</script>"""

API = """<h1>Supplier Watch API</h1>
<p>A read-only JSON API for the <strong>Pro</strong> and <strong>Accountant</strong> plans: your suppliers, their latest check results and your alerts, for your own systems (ERP, accounting, dashboards).</p>
<h2>Authentication</h2>
<p>Create a key on your manage page (API keys section). It is shown once; we store only a hash. Send it as a Bearer token:</p>
<pre><code>curl -H "Authorization: Bearer sw_..." https://supplierwatch.cz/api/v1/suppliers</code></pre>
<p>You can have up to 5 active keys and revoke any of them at any time. A revoked key stops working immediately.</p>
<h2>Limits</h2>
<p>60 requests per minute per key. Every response carries <code>X-RateLimit-Limit</code> and <code>X-RateLimit-Remaining</code>; over the limit you get <code>429</code> with <code>Retry-After</code> (seconds). Data change once a day (checks run at 06:30 Prague time), so polling more than a few times a day isn't useful.</p>
<h2>Endpoints</h2>
<table>
<tr><th>Endpoint</th><th>Returns</th></tr>
<tr><td><code>GET /api/v1/account</code></td><td>Your plan, supplier limit and counts</td></tr>
<tr><td><code>GET /api/v1/suppliers</code></td><td>All suppliers with their latest results. Filters: <code>status=ok|alert|failed|pending</code>, <code>client=&lt;id&gt;</code> (or <code>main</code>). Paginated.</td></tr>
<tr><td><code>GET /api/v1/suppliers/{ico}</code></td><td>One supplier (8-digit IČO). If the IČO is on several client lists, the others are in <code>also_in</code>; use <code>client=</code> to pick one.</td></tr>
<tr><td><code>GET /api/v1/alerts?since=2026-10-01</code></td><td>Check results with an alert, a change or a failed source since the given ISO 8601 date or time (default: last 30 days, at most 24 months back), newest first. Filter: <code>client=</code>. Paginated.</td></tr>
<tr><td><code>GET /api/v1/clients</code></td><td>Accountant plan: your client lists with supplier counts. Paginated.</td></tr>
<tr><td><code>GET /api/v1/sources</code></td><td>Latest daily self-check of each data source</td></tr>
</table>
<h2>Pagination</h2>
<p>List endpoints take <code>limit</code> (1 to 200, default 50) and <code>offset</code> (default 0) and return:</p>
<pre><code>{ "data": [ ... ], "pagination": { "limit": 50, "offset": 0, "total": 312, "next_offset": 50 } }</code></pre>
<p><code>next_offset</code> is <code>null</code> on the last page.</p>
<h2>Supplier object</h2>
<pre><code>{
  "ico": "27082440",
  "client": null,                      // or { "id": "cl_...", "name": "Novák s.r.o." }
  "website": "alza.cz",
  "name": "Alza.cz a.s.",
  "last_checked": "2026-10-21T04:30:12.000Z",
  "status": "ok",                      // ok | alert | failed | pending (not checked yet)
  "checks": {
    "ares":     { "status": "ok", "detail": "registered: ..." },
    "vat":      { "status": "ok", "detail": "not unreliable (PLATCE_DPH)" },
    "accounts": { "status": "ok", "detail": "3 published accounts" },
    "isir":     { "status": "ok", "detail": "no proceedings" },
    "coi":      { "status": "ok", "detail": "alza.cz not listed" }
  },
  "alerts": [],                        // e.g. "UNRELIABLE_VAT_PAYER", "INSOLVENCY_PROCEEDING"
  "changes": []                        // e.g. { "type": "BANK_ACCOUNT_ADDED", "to": "123/0100" }
}</code></pre>
<p>Check status is <code>ok</code>, <code>alert</code>, <code>failed</code> (the source did not answer or failed our daily self-check, so <strong>no result is claimed</strong>), <code>not_run</code> (not applicable, e.g. no website) or <code>invalid</code>. Times are UTC.</p>
<h2>Errors</h2>
<p>Errors always look like this:</p>
<pre><code>{ "error": { "code": "invalid_api_key", "message": "API key not recognised." } }</code></pre>
<table>
<tr><th>HTTP</th><th>code</th><th>Meaning</th></tr>
<tr><td>400</td><td><code>invalid_parameter</code>, <code>invalid_ico</code></td><td>Bad query parameter or IČO</td></tr>
<tr><td>401</td><td><code>missing_api_key</code>, <code>invalid_api_key</code>, <code>revoked_api_key</code></td><td>No key, unknown key or revoked key</td></tr>
<tr><td>403</td><td><code>plan_required</code>, <code>account_not_confirmed</code></td><td>Your plan doesn't include the API (or client lists)</td></tr>
<tr><td>404</td><td><code>not_found</code></td><td>Unknown endpoint, or the IČO/client isn't on your account</td></tr>
<tr><td>405</td><td><code>method_not_allowed</code></td><td>The API is read-only; use GET</td></tr>
<tr><td>429</td><td><code>rate_limited</code></td><td>Too many requests; wait <code>Retry-After</code> seconds</td></tr>
</table>
<p>Each key only ever sees its own account's data. Questions: <a href="mailto:contact@supplierwatch.cz">contact@supplierwatch.cz</a>.</p>"""

for rel, title, desc, body, script in [
    ('about.html', 'About Supplier Watch', 'Who runs Supplier Watch CZ: Nicholas Kossow Jennings, sole trader, IČO 28948491, Prague. Contact contact@supplierwatch.cz.', ABOUT, ''),
    ('sources.html', 'Data sources', 'The official sources Supplier Watch uses: the VAT register, ARES, the insolvency register ISIR and the ČOI risky e-shop list, with licences and current status.', SOURCES, STATUS_JS),
    ('api.html', 'API documentation', 'Read-only JSON API of Supplier Watch for Pro and Accountant plans: suppliers, latest check results and alerts.', API, ''),
]:
    write(rel, page('', title, desc, body, '/' + rel, more=False, script=script))

today = datetime.date(2026, 10, 21).isoformat()
urls = ['/', '/check.html', '/about.html', '/sources.html', '/api.html', '/guides/'] + [f'/guides/{g["slug"]}.html' for g in GUIDES] + ['/terms.html', '/privacy.html']
write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{BASE}{u}</loc><lastmod>{today}</lastmod></url>\n' for u in urls) + '</urlset>\n')
write('robots.txt', f'User-agent: *\nDisallow: /manage\nDisallow: /confirm\nDisallow: /unsubscribe\nDisallow: /api/\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n')
print('ok', len(GUIDES))
