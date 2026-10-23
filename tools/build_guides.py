#!/usr/bin/env python3
"""Generates site/guides/*.html, site/sitemap.xml and site/robots.txt. Run: python3 tools/build_guides.py"""
import os, datetime
ROOT = os.path.join(os.path.dirname(__file__), '..', 'site')
BASE = 'https://supplierwatch.cz'
UPDATED = '22 October 2026'
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
<p>Checking by hand works for one supplier. For a list of suppliers, the hard part is noticing when something changes.<!--if monitoring--> Supplier Watch runs all of these checks every morning and emails you only when a status, an address, a bank account or an insolvency record changes. Free for up to 5 suppliers.<!--end--><!--if paused--> The <a href="/check.html">free Supplier Watch check</a> runs all of these checks for one IČO in one go, without an account.<!--end--></p>
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

# ---------- Shared links for the guides below ----------
L_ZDPH = '<a href="https://www.zakonyprolidi.cz/cs/2004-235" rel="noopener">Act No. 235/2004 Sb., on VAT (zakonyprolidi.cz)</a>'
L_REG = '<a href="https://adisspr.mfcr.cz/dpr/DphReg" rel="noopener">VAT register (Registr plátců DPH), Financial Administration</a>'
L_REGHELP = '<a href="https://adisspr.mfcr.cz/adis/idph/a_napo_i_dph.htm" rel="noopener">VAT register help in English</a>'
L_FSUNREL = '<a href="https://financnisprava.gov.cz/en/taxes/tax-obligations/value-added-tax/unreliable-vat-payer/information-on-an-unreliable-vat-payer-in-the-czech-republic" rel="noopener">Information on an unreliable VAT payer (Financial Administration, English)</a>'
L_FSRUC = '<a href="https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/informace-stanoviska-a-sdeleni/ruceni" rel="noopener">Ručení: information and guidance on VAT liability (Financial Administration)</a>'
L_FSRUCPDF = '<a href="https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/2021_DPH_Info_k_ruceni.pdf" rel="noopener">Information on VAT liability and §109a (Financial Administration, PDF, Czech)</a>'
L_INS = '<a href="https://www.zakonyprolidi.cz/cs/2006-182" rel="noopener">Act No. 182/2006 Sb., the Insolvency Act (zakonyprolidi.cz)</a>'
L_ISIR = '<a href="https://isir.justice.cz/" rel="noopener">Insolvency register ISIR, Ministry of Justice</a>'
L_ARES = '<a href="https://ares.gov.cz/" rel="noopener">ARES, Ministry of Finance</a>'
L_OR = '<a href="https://or.justice.cz/" rel="noopener">Public register (Veřejný rejstřík), Ministry of Justice</a>'
L_OZ = '<a href="https://www.zakonyprolidi.cz/cs/2012-89" rel="noopener">Act No. 89/2012 Sb., the Civil Code, §187 (zakonyprolidi.cz)</a>'
L_VIES = '<a href="https://ec.europa.eu/taxation_customs/vies/" rel="noopener">VIES VAT number validation, European Commission</a>'
L_COI = '<a href="https://www.coi.gov.cz/pro-spotrebitele/rizikove-e-shopy/" rel="noopener">Risky e-shops list (Rizikové e-shopy), ČOI</a>'

def G(slug, text): return f'<a href="/guides/{slug}.html">{text}</a>'
G109 = 'czech-vat-liability-unreliable-payer-bank-accounts'
GCHECK = 'how-to-check-a-czech-supplier'
GFOREIGN = 'doing-business-with-czech-suppliers'

def src(*links): return '<h2>Official sources</h2><ul>' + ''.join(f'<li>{l}</li>' for l in links) + '</ul>'
def meta(mins): return f'<p class="meta">Updated {UPDATED} · about {mins} minutes</p>'

ALERT = '<!--if monitoring--><p>A supplier\'s status can change on any day. Supplier Watch checks the registers every morning and emails you the day a supplier you watch changes, free for up to 5 suppliers.</p><!--end--><!--if paused--><p>A supplier\'s status can change on any day. The <a href="/check.html">free Supplier Watch check</a> runs all of these register checks for one IČO in one go, without an account.</p><!--end-->'

TIMING = 'Under §109(1) of the VAT Act, what counts is what you knew or should have known <strong>when the obligation to declare the VAT arose</strong> and, where that was the moment of supply, also <strong>when you paid</strong>. The presumptions in §109(2), such as unreliable status or an unpublished account, are tested at those moments, not when you signed the contract.'

def faq(*qa): return '<h2>Frequently asked questions</h2>' + ''.join(f'<h3>{q}</h3><p>{a}</p>' for q, a in qa)

# ---------- Guide 4 ----------
guide('czech-unreliable-vat-payer-list',
 'The Czech unreliable VAT payer list: what it is and how to check it',
 'What the Czech list of unreliable VAT payers (nespolehlivý plátce) is, who ends up on it, how to search it, and why one check before signing is not enough.',
 f"""<h1>The Czech unreliable VAT payer list</h1>
{meta(5)}
<p>The Czech tax administration publishes which VAT payers it has declared <strong>unreliable</strong> (nespolehlivý plátce). If you are a Czech VAT payer and buy from a supplier that is on this list, the law presumes you knew its VAT might not be paid, and you can be asked to pay that VAT yourself. See {G(G109, 'our guide to §109 VAT liability')}.</p>
<h2>What is an unreliable VAT payer (nespolehlivý plátce)?</h2>
<p>An unreliable VAT payer is a VAT-registered business that the tax administrator has formally decided has <strong>seriously breached its obligations</strong> in the administration of tax, where the breach is not a reason to cancel its registration outright (§106a(1) of the VAT Act). The decision is published online (§106ac(4)), and that publication is what triggers the buyer-side presumption in §109(2)(a).</p>
<h2>Who ends up on the unreliable payer list, and how they get off it</h2>
<p>The supplier can appeal within 15 days and the appeal normally suspends the decision (§106a(2)). There is a separate status, <strong>unreliable person</strong> (nespolehlivá osoba, §106aa), for businesses that are not VAT payers; if such a business later registers for VAT it becomes an unreliable payer automatically (§106a(4)). A payer can ask to be removed, but no earlier than one year after the decision became final, and only if it has not seriously breached its tax duties for that year (§106ac(1) and (3)).</p>
<h2>How to search the VAT register for unreliable payers</h2>
<ol>
<li>Open the {L_REG}.</li>
<li>Enter the supplier's DIČ without "CZ" (for a company this is usually its IČO). You can enter up to 20 numbers at once.</li>
<li>Read the field <em>Nespolehlivý plátce</em>: <strong>NE</strong> means not unreliable, <strong>ANO</strong> means unreliable.</li>
<li>Leave the number empty and choose "nespolehlivý plátce" to see the whole published list.</li>
</ol>
<p>The register's {L_REGHELP} explains the search form.</p>
<h2>Why checking once before you sign is not enough</h2>
<p>{TIMING} A supplier that was fine in January can be published in March. That is why the Financial Administration and tax advisers recommend checking before each payment; see {G('how-often-to-check-czech-supplier-vat-status', 'how often to check')}. If you already paid an unreliable payer, read {G('supplier-became-unreliable-vat-payer', 'what to do when a supplier becomes unreliable')}.</p>
{ALERT}
{CTA}
{faq(
 ('Is the unreliable payer list a separate register?', 'No. Unreliable status is a field in each payer’s entry in the VAT register. The register also offers a listing view of all currently published unreliable payers and unreliable persons.'),
 ('Does VIES show unreliable payer status?', 'No. VIES only confirms that an EU VAT number is valid. Unreliable status and published bank accounts are only in the Czech register; see ' + G('vies-vs-czech-vat-register', 'VIES vs the Czech VAT register') + '.'),
 ('My supplier is not a VAT payer. Can it be on the list?', 'Not as an unreliable payer. A non-payer can be declared an unreliable person (§106aa), which is published the same way. The §109 presumption only applies to purchases from VAT payers.'),
)}
{src(L_ZDPH, L_REG, L_REGHELP, L_FSUNREL)}
{DISCLAIMER}""", 'Unreliable payer list')

# ---------- Guide 5 ----------
guide('supplier-became-unreliable-vat-payer',
 'Your Czech supplier became an unreliable VAT payer: what to do',
 'Steps to take when a Czech supplier is published as an unreliable VAT payer: before you pay the next invoice, paying the VAT to the tax office under §109a, and what to do about invoices already paid.',
 f"""<h1>Your Czech supplier became an unreliable VAT payer: what to do</h1>
{meta(5)}
<p>You found out that a supplier is now published as an unreliable VAT payer (nespolehlivý plátce). This guide covers the practical options. It applies if you are a Czech VAT payer buying a taxable supply in the Czech Republic.</p>
<h2>1. Confirm the status in the register and record the date</h2>
<p>Look the supplier up in the {L_REG} and save a printout or screenshot. Note the date from which the supplier is published as unreliable. {TIMING} So for each invoice, compare that publication date with the supply date and with your payment date.</p>
<h2>2. Unpaid invoices: pay the VAT part straight to the tax office (§109a)</h2>
<p>For an invoice you have not yet paid, you can pay the supplier only the price without VAT and pay the VAT part directly to the supplier's tax office. This is the <strong>special way of securing tax</strong> under §109a. The Financial Administration states that a buyer who pays the VAT this way cannot become guarantor for the VAT on that supply. You must do it before you are called on as guarantor. See {G('pay-vat-for-supplier-czech-109a', 'how to pay VAT for a supplier under §109a')}.</p>
<p>Your contract may say you must pay the full amount to the supplier. Many Czech contracts include a clause allowing §109a payments; check yours, or agree it with the supplier.</p>
<h2>3. Invoices you already paid: liability is not automatic</h2>
<p>The tax office first tries to collect the VAT from the supplier, and can only call on you as guarantor if the supplier does not pay. Keep your records of the checks you made. If a call (výzva ručiteli) arrives, talk to a tax adviser.</p>
<h2>4. Decide whether to keep the supplier</h2>
<p>An unreliable status means the tax office found a serious breach of tax duties. Consider dropping advance payments, paying only after delivery, or finding another supplier. Check also the {G('czech-insolvency-register-isir-english', 'insolvency register')}.</p>
{ALERT}
{CTA}
{src(L_ZDPH, L_REG, L_FSRUC, L_FSRUCPDF)}
{DISCLAIMER}""", 'Supplier became unreliable')

# ---------- Guide 6 ----------
guide('pay-vat-for-supplier-czech-109a',
 'Paying VAT directly for your supplier (§109a): the Czech "special way of securing tax"',
 'How a Czech VAT payer can pay its supplier’s VAT straight to the supplier’s tax office under §109a of the VAT Act, what the payment must identify, and why it removes the §109 liability for that supply.',
 f"""<h1>Paying VAT directly for your supplier (§109a)</h1>
{meta(5)}
<p>Czech VAT law gives buyers a way to remove the risk of {G(G109, '§109 liability')}: pay the supplier's VAT yourself, directly to the supplier's tax office. The law calls it <strong>zvláštní způsob zajištění daně</strong>, the special way of securing tax (§109a of the VAT Act).</p>
<h2>What §109a says</h2>
<ul>
<li>If the buyer pays the VAT on a supply for the supplier <strong>without having been called on as guarantor</strong>, the payment is used only for the supplier's VAT on that supply (§109a(1)).</li>
<li>The payment goes to the <strong>supplier's tax administrator</strong> (§109a(2)). It is credited to the supplier's personal deposit account and moved to its tax account when the VAT falls due (§109a(4)).</li>
<li>With the payment you must state, in the way the tax administrator publishes: the supplier's identification, the tax the payment is for, your own identification, and the date of the supply or of payment (§109a(2)). If the date is missing, the date the tax office receives the money is used (§109a(3)).</li>
</ul>
<h2>Why paying under §109a removes the §109 risk</h2>
<p>The Financial Administration's guidance on liability says a buyer who pays the VAT this way can never become guarantor under §109 for that supply. It is the clean option when a supplier turns out to be {G('czech-unreliable-vat-payer-list', 'an unreliable VAT payer')}, or the invoice shows a {G('czech-published-bank-account-check', 'bank account that is not published')}.</p>
<h2>How to pay a supplier's VAT to the tax office, step by step</h2>
<ol>
<li>Find the supplier's tax office (it is shown in the {L_REG}).</li>
<li>Look up that office's account and payment details on the Financial Administration website, as the law refers to the way the tax administrator publishes them.</li>
<li>Pay the supplier the price without VAT, and the VAT to the tax office, with the required details.</li>
<li>Tell the supplier, and keep proof of both payments.</li>
</ol>
<p>Payments made this way are voluntary and the guidance says they are not refunded to you later, even if the supplier's VAT is corrected. Get your exact payment details confirmed by a tax adviser the first time.</p>
{CTA}
{faq(
 ('Does the supplier have to agree to a §109a payment?', 'The VAT Act does not require the supplier’s consent. Your contract might, because it may oblige you to pay the full invoice to the supplier. Agree it in writing to avoid a dispute about short payment.'),
 ('Can I get the money back if the supplier pays its VAT after all?', 'No. The payment is treated as the supplier’s payment of its own tax. Any overpayment belongs to the supplier, so settle it with them, not the tax office.'),
 ('I am a foreign buyer, not registered for Czech VAT. Does §109a apply to me?', 'No. §109 liability and the §109a option both apply to recipients who are Czech VAT payers. If you are not one, the risk does not arise. See ' + G(GFOREIGN, 'our guide for foreign companies') + '.'),
)}
{src(L_ZDPH, L_FSRUC, L_FSRUCPDF, L_REG)}
{DISCLAIMER}""", 'Paying VAT for a supplier (§109a)')

# ---------- Guide 7 ----------
guide('czech-published-bank-account-check',
 'Checking a Czech supplier’s published bank account before you pay',
 'How to check that the bank account on a Czech invoice is one the supplier has published in the VAT register, how to read the account history, and what happens if you pay to an unpublished account.',
 f"""<h1>Checking a Czech supplier's published bank account</h1>
{meta(4)}
<p>Czech VAT payers publish the bank accounts they use for business in the VAT register. When you pay a Czech VAT payer by bank transfer to an account that is <strong>not</strong> published, the law presumes you knew its VAT might go unpaid (§109(2)(c)(2) of the VAT Act). Since 1 January 2025, when §109 was rewritten by Act No. 461/2024 Sb., there is no minimum amount for this rule. Details are in {G(G109, 'our §109 guide')}.</p>
<h2>Where the published accounts come from (§96 and §98)</h2>
<p>A VAT payer lists all accounts used for its business when it registers and chooses which of them are published (§96). The tax administrator publishes the chosen accounts, or the fact that none was chosen (§98(d)).</p>
<h2>How to check an invoice account against the VAT register</h2>
<ol>
<li>Open the {L_REG} and enter the supplier's DIČ without "CZ".</li>
<li>Look at <em>Bankovní účty</em> (bank accounts) and the date each was published.</li>
<li>Compare the account number on the invoice exactly, digit for digit, including the bank code.</li>
<li>Use the account history (historie účtů) to see accounts whose publication ended.</li>
</ol>
<h2>What to do if the account on the invoice is not published</h2>
<ul>
<li>Do not pay to it until you have checked with the supplier through a contact you already trust, not the one on the invoice or email. See {G('supplier-changed-bank-account-fraud', 'bank-account change fraud')}.</li>
<li>Ask the supplier to publish the account, or to give you a published one.</li>
<li>Or pay the VAT part directly to the tax office under {G('pay-vat-for-supplier-czech-109a', '§109a')}.</li>
</ul>
<p>Accounts abroad are not published in the Czech register, so a transfer to a foreign account is treated the same way.</p>
{ALERT}
{CTA}
{src(L_ZDPH, L_REG, L_REGHELP, L_FSRUC)}
{DISCLAIMER}""", 'Published bank accounts')

# ---------- Guide 8 ----------
guide('supplier-changed-bank-account-fraud',
 '"Our bank details have changed": invoice fraud and Czech suppliers',
 'How fake "new bank account" emails work, how to verify a Czech supplier’s account using the official VAT register, and a simple payment process that protects against invoice redirection.',
 f"""<h1>"Our bank details have changed": invoice fraud and Czech suppliers</h1>
{meta(4)}
<p>A common fraud is a message that looks like it comes from a real supplier and asks you to pay future invoices to a new bank account. The email may come from a hacked mailbox or a look-alike address, and the invoice may look genuine.</p>
<h2>Why a Czech supplier's bank account is easier to verify</h2>
<p>Czech VAT payers must list their business accounts with the tax office and can publish them in the {L_REG}. A real new account usually appears there. An account that is not published is a warning sign, and paying it also creates a {G(G109, '§109 VAT liability')} risk for Czech VAT payers.</p>
<h2>A five-step payment process that stops invoice redirection</h2>
<ol>
<li>Never change payment details on the strength of an email or invoice alone.</li>
<li>Call the supplier on a number you already had, not one in the message.</li>
<li>Check the new account in the VAT register ({G('czech-published-bank-account-check', 'how to check')}).</li>
<li>Have a second person approve any change of supplier bank details.</li>
<li>Recheck the published accounts right before each payment run.</li>
</ol>
<p>If you think you paid a fraudster, contact your bank at once and report it to the police.</p>
<!--if monitoring--><p>Supplier Watch emails you when a watched supplier's published accounts change, so a real change and a fake one look different: one shows up in the register, the other does not.</p><!--end-->
{CTA}
{src(L_REG, L_ZDPH)}
{DISCLAIMER}""", 'Bank-account change fraud')

# ---------- Guide 9 ----------
guide('czech-insolvency-register-isir-english',
 'The Czech insolvency register (ISIR) in English: search by IČO and read the file',
 'How to search the Czech insolvency register ISIR by IČO, what the main Czech terms mean in English, how long entries stay visible, and when to check a supplier for insolvency.',
 f"""<h1>The Czech insolvency register (ISIR) in English</h1>
{meta(5)}
<p>ISIR (insolvenční rejstřík) is the public register of insolvency proceedings, run by the Ministry of Justice (§419 of the Insolvency Act). It holds a list of debtors and the insolvency file for each one. Anyone may search it and take copies, free of charge (§419(3)).</p>
<h2>How to search ISIR by IČO or name</h2>
<ol>
<li>Open {L_ISIR}.</li>
<li>Enter the supplier's IČO (or name) and search.</li>
<li>If a proceeding exists, open it to see the file: the petition, court decisions and their dates.</li>
</ol>
<h2>Czech insolvency terms you will see, in English</h2>
<table>
<tr><th>Czech</th><th>English</th></tr>
<tr><td>Insolvenční návrh</td><td>Insolvency petition. Proceedings start on the day it reaches the court (§97(1)).</td></tr>
<tr><td>Úpadek</td><td>Insolvency (the debtor is found insolvent)</td></tr>
<tr><td>Rozhodnutí o úpadku</td><td>Decision declaring insolvency</td></tr>
<tr><td>Konkurs</td><td>Bankruptcy (liquidation of assets)</td></tr>
<tr><td>Reorganizace</td><td>Reorganisation</td></tr>
<tr><td>Oddlužení</td><td>Debt relief (mainly for individuals)</td></tr>
<tr><td>Insolvenční správce</td><td>Insolvency administrator</td></tr>
<tr><td>Přihláška pohledávky</td><td>Filing of a creditor's claim</td></tr>
<tr><td>Odmítnutí / zamítnutí návrhu</td><td>Petition rejected or dismissed</td></tr>
</table>
<h2>What an insolvency petition means for orders, advance payments and claims</h2>
<p>A petition is not proof that the supplier is insolvent; some are rejected. But it is an early warning: think twice about advance payments, long warranties or big orders, and if the supplier owes you money, deadlines for filing claims apply. Ask a lawyer about those.</p>
<p>ISIR changes daily. For other checks see {G(GCHECK, 'how to check a Czech supplier')}.</p>
{ALERT}
{CTA}
{faq(
 ('How long does a company stay in ISIR after the proceedings end?', 'Five years after the decision ending the proceedings became final, the court removes the debtor from the list and hides the data (§425(1)). A debtor whose petition was dismissed for lack of assets can ask for earlier removal.'),
 ('Does a petition mean the supplier has stopped trading?', 'No. The company keeps operating until the court decides, and often during reorganisation. Treat a petition as a reason to tighten terms, not as proof of failure.'),
 ('Is liquidation the same as insolvency?', 'No. Liquidation is a winding-up procedure under the Civil Code and is recorded in the public register, not ISIR. See ' + G('czech-company-in-liquidation', 'how to tell if a company is in liquidation') + '.'),
)}
{src(L_ISIR, L_INS)}
{DISCLAIMER}""", 'Insolvency register (ISIR)')

# ---------- Guide 10 ----------
guide('czech-company-in-liquidation',
 'How to tell if a Czech company is in liquidation or has been struck off',
 'How to see in ARES and the public register whether a Czech company is in liquidation ("v likvidaci"), dissolved or deleted, and what that means for orders and payments.',
 f"""<h1>How to tell if a Czech company is in liquidation or has been struck off</h1>
{meta(4)}
<p>A Czech company that is winding up does not disappear overnight. It goes through liquidation, which is recorded in the public registers and even in its name, and only afterwards is it deleted. This guide shows where each stage is visible and what it means if the company is your supplier.</p>
<h2>The quick sign: "v likvidaci" after the name</h2>
<p>Under §187(2) of the Civil Code, a legal entity enters liquidation on the day it is dissolved, and while in liquidation it uses its name with the addition <strong>"v likvidaci"</strong> (in liquidation). The liquidator must have the entry into liquidation recorded in the public register without undue delay.</p>
<p>The purpose of liquidation is to settle the company's assets, pay its creditors and deal with what is left (§187(1)). Once it is in liquidation, nobody may act for it beyond what the law allows for winding up (§188).</p>
<h2>Where to check liquidation and deletion: ARES, the public register, ISIR</h2>
<ol>
<li>{L_ARES}: search the IČO. Look at the name, the status of the record, and the date of deletion (datum zániku) if any.</li>
<li>{L_OR}: open the company's extract (výpis). It shows entry into liquidation, the liquidator (likvidátor) and deletion from the register (výmaz).</li>
<li>{L_ISIR}: liquidation and insolvency are different procedures; check both.</li>
</ol>
<h2>What liquidation means for your orders and claims</h2>
<ul>
<li>Do not make advance payments to a company in liquidation without advice.</li>
<li>If it owes you money, file your claim with the liquidator.</li>
<li>Once a company is deleted from the register, it no longer exists.</li>
</ul>
<p>See also {G('ares-czech-business-register-english', 'how to read ARES in English')}.</p>
{ALERT}
{CTA}
{src(L_OZ, L_ARES, L_OR, L_ISIR)}
{DISCLAIMER}""", 'Liquidation and deletion')

# ---------- Guide 11 ----------
guide('ares-czech-business-register-english',
 'ARES, the Czech business register, explained in English',
 'What ARES is, how to look up a Czech company by IČO or name, and an English translation of the main fields in an ARES record.',
 f"""<h1>ARES, the Czech business register, explained in English</h1>
{meta(4)}
<p>ARES (Administrativní registr ekonomických subjektů) is run by the Ministry of Finance. It brings together data about businesses from several public registers, including the public (commercial) register, the trade licence register and the VAT register. It is free and needs no account.</p>
<h2>How to search ARES by IČO or company name</h2>
<ol>
<li>Open {L_ARES}.</li>
<li>Type the IČO (8 digits) or the company name.</li>
<li>Open the result to see the record and links to the source registers.</li>
</ol>
<h2>The main ARES fields translated into English</h2>
<table>
<tr><th>Czech</th><th>English</th></tr>
<tr><td>Obchodní jméno / firma</td><td>Business name</td></tr>
<tr><td>IČO</td><td>Company identification number</td></tr>
<tr><td>DIČ</td><td>Tax / VAT number</td></tr>
<tr><td>Sídlo</td><td>Registered office</td></tr>
<tr><td>Právní forma</td><td>Legal form (s.r.o., a.s., sole trader…)</td></tr>
<tr><td>Datum vzniku</td><td>Date of establishment</td></tr>
<tr><td>Datum zániku</td><td>Date of deletion</td></tr>
<tr><td>Statutární orgán / jednatel</td><td>Statutory body / managing director</td></tr>
<tr><td>Společníci</td><td>Shareholders (of an s.r.o.)</td></tr>
<tr><td>Spisová značka</td><td>File number in the public register</td></tr>
<tr><td>Předmět podnikání</td><td>Line of business</td></tr>
</table>
<h2>What ARES does not tell you: VAT reliability, bank accounts, insolvency</h2>
<p>ARES shows who the company is. For VAT reliability and bank accounts use the {L_REG}; for insolvency use {G('czech-insolvency-register-isir-english', 'ISIR')}. A recent change of address, director or name is worth a second look: open the extract in the {L_OR} to see when and why it changed, and check {G('czech-company-in-liquidation', 'whether the company has entered liquidation')}.</p>
{ALERT}
{CTA}
{faq(
 ('Is ARES the same as the commercial register?', 'No. The public (commercial) register is run by the courts and holds the legally binding extract. ARES is a Ministry of Finance aggregator that shows a summary and links to the source registers.'),
 ('Does ARES show whether a company is a VAT payer?', 'It shows the DIČ if one exists and links to the VAT register, but it does not show unreliable status or published bank accounts. Use the VAT register for those.'),
 ('Can I look up a sole trader in ARES?', 'Yes. Sole traders (OSVČ) have an IČO and appear in ARES with data from the trade licence register.'),
)}
{src(L_ARES, L_OR, L_REG)}
{DISCLAIMER}""", 'ARES in English')

# ---------- Guide 12 ----------
guide('ico-vs-dic-czech-company-id-vat-number',
 'IČO vs DIČ: the Czech company ID and VAT number explained',
 'The difference between IČO (Czech company identification number) and DIČ (tax and VAT number), how they relate for companies, how the IČO check digit works, and how to find one from the other.',
 f"""<h1>IČO vs DIČ: the Czech company ID and VAT number</h1>
{meta(4)}
<p>Czech invoices and contracts carry two numbers that look alike and are easy to mix up. The IČO identifies the business in the company registers. The DIČ identifies it to the tax office and doubles as the VAT number. Here is how they differ, how they relate, and how to check one.</p>
<table>
<tr><th></th><th>IČO</th><th>DIČ</th></tr>
<tr><td>What it is</td><td>Identification number of a person or business</td><td>Tax identification number; used as the VAT number</td></tr>
<tr><td>Format</td><td>8 digits, the last one a check digit</td><td>"CZ" followed by 8 to 10 digits</td></tr>
<tr><td>Used for</td><td>Business registers (ARES, public register, ISIR)</td><td>VAT register, invoices, VIES</td></tr>
</table>
<h2>How IČO and DIČ relate</h2>
<p>For a legal entity the digits after "CZ" are normally the same as its IČO, unless the tax office assigned a special number. For an individual (sole trader) the DIČ is usually based on the birth number, not the IČO. This is how the {L_REGHELP} describes it.</p>
<h2>How the IČO check digit works (modulo 11)</h2>
<p>You can spot a mistyped IČO without any register. Multiply the first seven digits by the weights 8, 7, 6, 5, 4, 3, 2, add the products, and take the remainder after dividing by 11. The check digit is 11 minus that remainder; if the result is 10 the check digit is 0, and if it is 11 the check digit is 1.</p>
<p>Example with the IČO 28948491: 2×8 + 8×7 + 9×6 + 4×5 + 8×4 + 4×3 + 9×2 = 208. 208 divided by 11 leaves remainder 10. 11 − 10 = 1, which matches the last digit. An IČO that fails this test was copied wrongly, so check the invoice before you search.</p>
<h2>Finding one number from the other</h2>
<ul>
<li>Have the IČO? Look it up in {L_ARES}; the record shows the DIČ if one exists.</li>
<li>Have the DIČ? Search it in the {L_REG}, or check it across the EU in {G('vies-vs-czech-vat-register', 'VIES')}.</li>
</ul>
<p>A company with an IČO but no DIČ in ARES is probably not a VAT payer. Then the {G(G109, '§109 rules')} on unreliable payers do not apply to purchases from it.</p>
{CTA}
{faq(
 ('Can I work out a sole trader’s DIČ from their IČO?', 'No. A sole trader’s DIČ is normally derived from the birth number, which is personal data and not in the registers. Ask the supplier, or search the VAT register by name.'),
 ('Is every DIČ a VAT number?', 'No. Any registered taxpayer can have a DIČ, including businesses that are not VAT payers. Only VAT payers and identified persons appear in the VAT register, and only VAT payers validate in VIES.'),
 ('Do I type the "CZ" prefix when searching?', 'In VIES, yes: choose CZ and enter the digits. In the Czech VAT register, enter the digits without "CZ".'),
)}
{src(L_REGHELP, L_ARES, L_REG)}
{DISCLAIMER}""", 'IČO vs DIČ')

# ---------- Guide 13 ----------
guide('vies-vs-czech-vat-register',
 'VIES vs the Czech VAT register: why foreign buyers need both',
 'VIES confirms that an EU VAT number is valid today. The Czech VAT register also shows unreliable-payer status, published bank accounts and history. What each check tells you and when to use it.',
 f"""<h1>VIES vs the Czech VAT register</h1>
{meta(4)}
<p>Companies outside the Czech Republic usually check a Czech supplier's VAT number in VIES, the European Commission's validation service. That is a useful check, but it answers a different question from the Czech register.</p>
<table>
<tr><th></th><th>VIES</th><th>Czech VAT register</th></tr>
<tr><td>Run by</td><td>European Commission, querying national databases</td><td>Czech Financial Administration</td></tr>
<tr><td>Tells you</td><td>Whether the VAT number is valid for cross-border EU trade today, often with name and address</td><td>VAT payer status, <strong>unreliable payer</strong> status, <strong>published bank accounts</strong>, tax office, and the dates each changed</td></tr>
<tr><td>Main use</td><td>Supporting zero-rated intra-EU supplies</td><td>Avoiding Czech {G(G109, '§109 VAT liability')}, checking accounts</td></tr>
</table>
<h2>What VIES tells you about a Czech VAT number, and what it does not</h2>
<p>VIES passes your query to the Czech database and returns valid or invalid for the moment you ask. It keeps no history, so it cannot tell you whether a number was valid on the date you paid an invoice last month. Save the consultation number VIES offers; that is your evidence of the check. VIES says nothing about unreliable status, bank accounts or insolvency.</p>
<h2>When you need the Czech VAT register as well</h2>
<ul>
<li>You are registered for Czech VAT and buy supplies taxed in the Czech Republic: §109 applies to you.</li>
<li>You pay a Czech supplier and want to confirm the account is theirs: see {G('czech-published-bank-account-check', 'published bank accounts')}.</li>
<li>You want to know when a supplier became a VAT payer or stopped being one: the Czech register shows the dates.</li>
</ul>
<p>Our {G(GFOREIGN, 'guide for foreign companies')} covers the wider picture.</p>
{CTA}
{faq(
 ('Does VIES show Czech unreliable payer status?', 'No. Only the Czech VAT register does. See ' + G('czech-unreliable-vat-payer-list', 'the unreliable payer list') + '.'),
 ('My supplier is valid in VIES but has no published bank account. Is that a problem?', 'For a buyer that is a Czech VAT payer, yes: paying to an unpublished account triggers the §109 presumption. For a foreign buyer with no Czech VAT registration it is a fraud warning sign rather than a tax risk.'),
 ('Which should I check first?', 'For a one-off cross-border purchase, VIES. For a Czech supplier you will pay repeatedly, the Czech register, and VIES as well if you zero-rate your own supplies to them.'),
)}
{src(L_VIES, L_REG, L_REGHELP, L_ZDPH)}
{DISCLAIMER}""", 'VIES vs Czech register')

# ---------- Guide 14 ----------
guide('czech-supplier-due-diligence-checklist',
 'Czech supplier due diligence checklist: before the first order, before each payment, and ongoing',
 'A practical checklist for checking Czech suppliers in free official registers: ARES, the VAT register, ISIR, the public register and the ČOI risky e-shops list, with when to run each check.',
 f"""<h1>Czech supplier due diligence checklist</h1>
{meta(4)}
<p>Every check below uses a free official register and takes a few minutes. The point of the checklist is timing: some checks matter once, before you sign, and others matter before every payment, because that is when {G(G109, '§109 liability')} is tested.</p>
<h2>Before the first order: identity, signing authority, VAT and insolvency</h2>
<table>
<tr><th>Check</th><th>Where</th></tr>
<tr><td>The company exists, the name and address match the contract</td><td>{L_ARES}</td></tr>
<tr><td>Not in liquidation or deleted</td><td>{G('czech-company-in-liquidation', 'liquidation guide')}</td></tr>
<tr><td>Who may sign for it (statutory body)</td><td>{L_OR}</td></tr>
<tr><td>VAT payer and not unreliable</td><td>{L_REG}</td></tr>
<tr><td>No insolvency proceedings</td><td>{L_ISIR}</td></tr>
<tr><td>Website not on the risky e-shops list</td><td>{G('coi-risky-e-shops-list', 'ČOI list')}</td></tr>
<tr><td>VAT number valid for EU trade (foreign buyers)</td><td>{G('vies-vs-czech-vat-register', 'VIES')}</td></tr>
</table>
<h2>Before each payment: unreliable status and the bank account</h2>
<ul>
<li>Supplier still not unreliable ({G('czech-unreliable-vat-payer-list', 'how to check')}).</li>
<li>The account on the invoice is published ({G('czech-published-bank-account-check', 'how to check')}).</li>
<li>No unexplained change of bank details ({G('supplier-changed-bank-account-fraud', 'fraud guide')}).</li>
</ul>
<h2>Ongoing: changes that should trigger a second look</h2>
<ul>
<li>New insolvency petitions, address, name or director changes.</li>
<li>Keep a record of each check with its date.</li>
</ul>
<p>{G(GCHECK, 'Our step-by-step guide')} walks through each register in detail. Running the list by hand for many suppliers takes time, and the hard part is noticing when something changes.</p>
{ALERT}
{CTA}
{src(L_ARES, L_OR, L_REG, L_ISIR, L_COI, L_VIES)}
{DISCLAIMER}""", 'Due diligence checklist')

# ---------- Guide 15 ----------
guide('coi-risky-e-shops-list',
 'The ČOI risky e-shops list: unsafe Czech online shops explained',
 'What the Czech Trade Inspection Authority’s list of risky e-shops (rizikové e-shopy) is, why websites are put on it, and how to check a site before you order.',
 f"""<h1>The ČOI risky e-shops list</h1>
{meta(3)}
<p>The Czech Trade Inspection Authority (Česká obchodní inspekce, ČOI) publishes a list of websites it considers risky, mainly because they do not meet legal duties and consumer rights are hard to enforce against them.</p>
<h2>Why ČOI puts a website on the risky e-shops list</h2>
<p>According to ČOI, mainly for two reasons:</p>
<ul>
<li>The website gives no contact details of the seller, so it is not clear who runs it or who you have a contract with.</li>
<li>The operator is known but based outside the EU, and the site lacks legally required information (such as terms), its terms grossly contradict the law, or ČOI has received many complaints about it.</li>
</ul>
<p>ČOI says the list is a recommendation to think carefully before buying, that it is updated regularly, and that it is not a complete list of risky shops. A site that is not on it is not automatically safe.</p>
<h2>How to check a website against the ČOI list</h2>
<ol>
<li>Open the {L_COI} page.</li>
<li>Search for the website's domain.</li>
<li>Also check who runs the site: a Czech seller should give its IČO, which you can look up in {G('ares-czech-business-register-english', 'ARES')}.</li>
</ol>
<!--if monitoring--><p>Supplier Watch can watch a supplier's website and tell you if it is added to or removed from the list.</p><!--end-->
{CTA}
{src(L_COI)}
{DISCLAIMER}""", 'ČOI risky e-shops')

# ---------- Guide 16 ----------
guide('how-often-to-check-czech-supplier-vat-status',
 'How often should you check a Czech supplier’s VAT status?',
 'Why the status that counts under Czech §109 is the one when the obligation to declare VAT arose and when you pay, a worked timeline, what that means for how often to check suppliers, and how to keep a record.',
 f"""<h1>How often should you check a Czech supplier's VAT status?</h1>
{meta(4)}
<p>Checking a supplier once, when you sign the contract, feels thorough. Under Czech VAT law it protects you for exactly that day. This guide explains which dates the law looks at and turns that into a checking routine.</p>
<h2>The two dates that matter under §109</h2>
<p>{TIMING} For an ordinary delivery with a later invoice, that means two moments: the day of supply and the day you pay.</p>
<h2>A worked example: contract in January, payment in March</h2>
<table>
<tr><th>Date</th><th>Event</th><th>Register shows</th><th>Exposed?</th></tr>
<tr><td>10 January</td><td>Contract signed, supplier checked</td><td>NE (not unreliable)</td><td>Nothing to pay yet</td></tr>
<tr><td>3 February</td><td>First delivery and invoice</td><td>NE</td><td>No, at the moment of supply</td></tr>
<tr><td>20 February</td><td>Supplier published as unreliable</td><td>ANO</td><td></td></tr>
<tr><td>5 March</td><td>You pay the February invoice</td><td>ANO</td><td><strong>Yes</strong>, the presumption applies at payment</td></tr>
<tr><td>12 March</td><td>Second delivery and invoice</td><td>ANO</td><td><strong>Yes</strong>, at the moment of supply</td></tr>
</table>
<p>The January check and even a check on the delivery day in February would have shown nothing. A check on 5 March, right before the payment run, would have caught it, and you could have paid the VAT part to the tax office under {G('pay-vat-for-supplier-czech-109a', '§109a')} instead.</p>
<h2>What that means for how often to check</h2>
<ul>
<li>A check when you sign the contract is not enough.</li>
<li>Check on the day of each payment, ideally right before the payment run.</li>
<li>Keep a dated record (printout, screenshot or report) of each check.</li>
</ul>
<h2>Doing the daily check without effort</h2>
<p>The VAT register is updated daily. For a handful of suppliers a manual check before each payment works.<!--if monitoring--> For more, Supplier Watch runs the check every morning, emails you the day a watched supplier changes, and keeps a dated log you can use as evidence. It is free for up to 5 suppliers.<!--end--><!--if paused--> For a single supplier the <a href="/check.html">free check</a> gives you a dated result you can save.<!--end--></p>
{CTA}
{faq(
 ('Does a check on the payment day protect me completely?', 'It rebuts the §109(2) presumptions, which is the main risk. The tax office can still argue you knew or should have known on other grounds, so keep the dated record and watch for other warning signs such as a price far below market.'),
 ('What counts as a record of the check?', 'A dated printout or screenshot of the register entry, or a report from a service that logs the check. The Financial Administration has not prescribed a form; what matters is that you can show the status on that date.'),
 ('Do I need to check VIES as often?', 'VIES matters for zero-rating your own supplies, not for §109. Check it when you issue intra-EU invoices and keep the consultation number. See ' + G('vies-vs-czech-vat-register', 'VIES vs the Czech VAT register') + '.'),
)}
{src(L_ZDPH, L_REG, L_FSUNREL)}
{DISCLAIMER}""", 'How often to check')

def write(rel, text):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(text)

import json
def article_ld(g):
    d = {'@context': 'https://schema.org', '@type': 'Article', 'headline': g['title'][:110], 'description': g['desc'],
         'dateModified': datetime.datetime.strptime(UPDATED, '%d %B %Y').date().isoformat(),
         'author': {'@type': 'Person', 'name': 'Nicholas Kossow Jennings', 'url': BASE + '/about.html'},
         'publisher': {'@type': 'Organization', 'name': 'Supplier Watch CZ', 'url': BASE + '/'},
         'mainEntityOfPage': BASE + '/guides/' + g['slug'] + '.html', 'inLanguage': 'en'}
    return '<script type="application/ld+json">' + json.dumps(d, ensure_ascii=False).replace('</', '<\\/') + '</script>\n'
for g in GUIDES:
    write(f'guides/{g["slug"]}.html', page(g['slug'], g['title'], g['desc'].replace('"', '&quot;'), g['body'], f'/guides/{g["slug"]}.html', script=article_ld(g)))
idx = '<h1>Guides: checking Czech suppliers</h1><p>Plain-English guides to the Czech registers and the VAT rules that affect buyers.</p>' + ''.join(
    f'<h2><a href="/guides/{g["slug"]}.html">{g["title"]}</a></h2><p>{g["desc"]}</p>' for g in GUIDES) + CTA + DISCLAIMER
write('guides/index.html', page('', 'Guides: checking Czech suppliers', 'Plain-English guides to Czech supplier checks: §109 VAT liability, ARES, the VAT register, ISIR, ČOI, and doing business with Czech suppliers as a foreign company.', idx, '/guides/'))

# ---------- Trust pages (About, Sources, API) ----------
ABOUT = """<h1>About Supplier Watch</h1>
<!--if monitoring--><p>Supplier Watch CZ checks Czech suppliers every morning in the official public registers and emails you, in English with the Czech wording alongside, only when something changes. Each month you also get a PDF report of every check, which you can keep as evidence that you checked your suppliers.</p><!--end--><!--if paused--><p>Supplier Watch CZ checks Czech suppliers in the official public registers, in English with the Czech wording alongside. Look up any supplier with the <a href="/check.html">free check</a>, no account needed.</p><!--end-->
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
<p><strong>Published by:</strong> the Czech Trade Inspection Authority (Česká obchodní inspekce, ČOI) as open data. <strong>We use:</strong> the daily CSV of risky websites, matched against the supplier websites you enter. If the list can't be downloaded, we use our saved copy if it is at most 7 days old, and the report shows its date. <strong>Terms:</strong> ČOI open-data licence, which allows commercial use with attribution and without implying endorsement: <a href="https://coi.gov.cz/pro-spotrebitele/otevrena-data/licence-otevrenych-dat/" rel="noopener">licence</a>. Zdroj: Česká obchodní inspekce. Supplier Watch is not affiliated with or endorsed by ČOI. <a href="https://www.coi.gov.cz/pro-spotrebitele/rizikove-e-shopy/" rel="noopener">The list on coi.gov.cz</a>.</p>
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
<p>A read-only JSON API for the <strong>Accountant</strong> plan: your suppliers, their latest check results and your alerts, for your own systems (ERP, accounting, dashboards).</p>
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
    ('api.html', 'API documentation', 'Read-only JSON API of Supplier Watch for the Accountant plan: suppliers, latest check results and alerts.', API, ''),
]:
    write(rel, page('', title, desc, body, '/' + rel, more=False, script=script))

today = datetime.date(2026, 10, 21).isoformat()
urls = ['/', '/check.html', '/about.html', '/sources.html', '/api.html', '/guides/'] + [f'/guides/{g["slug"]}.html' for g in GUIDES] + ['/terms.html', '/privacy.html']
write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{BASE}{u}</loc><lastmod>{today}</lastmod></url>\n' for u in urls) + '</urlset>\n')
write('robots.txt', f'User-agent: *\nDisallow: /manage\nDisallow: /confirm\nDisallow: /unsubscribe\nDisallow: /api/\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n')
print('ok', len(GUIDES))
