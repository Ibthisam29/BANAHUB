"""Idempotent SEO/GEO pass over BANAHUB static pages: meta, OG/Twitter, robots, JSON-LD, FAQ sections."""
import json, re, html, sys, os
ROOT = sys.argv[1]
FAQS = json.load(open(sys.argv[2]))
SITE = 'https://www.banahub.com'
OG = f'{SITE}/og-image.png'
ORG_ID = f'{SITE}/#organization'
SAMEAS = [u for u in os.environ.get('SAMEAS', '').split(',') if u]

ORG = {
  "@type": ["Organization", "ProfessionalService"], "@id": ORG_ID, "name": "BANAHUB", "legalName": "Bana Private Limited",
  "alternateName": ["Bana Hub", "Bana Private Limited", "FundMatch by BANAHUB"], "url": SITE + "/",
  "logo": {"@type": "ImageObject", "url": f"{SITE}/logo-icon-512.png", "width": 512, "height": 512}, "image": OG,
  "email": "hello@banahub.com", "foundingLocation": "Singapore",
  "identifier": {"@type": "PropertyValue", "propertyID": "UEN", "value": "201933473Z"},
  "address": {"@type": "PostalAddress", "addressCountry": "SG", "addressLocality": "Singapore"},
  "areaServed": [{"@type": "Country", "name": n} for n in ["Singapore", "Malaysia", "Indonesia", "Vietnam", "Thailand", "Philippines", "United Arab Emirates", "Saudi Arabia"]] + [{"@type": "Place", "name": "Southeast Asia"}],
  "knowsAbout": ["Singapore market entry", "ASEAN market entry", "Go-to-market strategy", "Cross-border expansion", "Capital readiness", "Investor readiness",
                 "Fundraising strategy", "Investor targeting", "Startup fundraising", "Venture capital", "Private equity", "Family offices", "Limited partners",
                 "Strategic partnerships", "Distribution and channel development", "Investor-company matching"],
  "description": "Singapore-based cross-border growth advisory firm helping growth-stage companies enter Singapore and ASEAN, build go-to-market traction, form strategic partnerships and prepare for fundraising, and giving investors mandate-screened opportunities. Advisory services only; not licensed by the Monetary Authority of Singapore.",
  "contactPoint": {"@type": "ContactPoint", "contactType": "customer service", "email": "hello@banahub.com", "areaServed": "SG", "availableLanguage": ["English"]},
}
if SAMEAS: ORG["sameAs"] = SAMEAS
WEBSITE = {"@type": "WebSite", "@id": f"{SITE}/#website", "url": SITE + "/", "name": "BANAHUB", "publisher": {"@id": ORG_ID}, "inLanguage": "en-SG"}

def svc(name, desc, url, types, audience):
    return {"@type": "Service", "@id": url + "#service", "name": name, "description": desc, "url": url, "serviceType": types,
            "provider": {"@id": ORG_ID}, "areaServed": [{"@type": "Place", "name": "Singapore"}, {"@type": "Place", "name": "Southeast Asia"}],
            "audience": {"@type": "BusinessAudience", "audienceType": audience}}

# page: (title, description, crumb name, schema extras, index?)
P = {
 'index': ("BANAHUB — Market Entry & Capital Access Advisory, Singapore & ASEAN",
           "BANAHUB helps growth-stage companies enter Singapore and ASEAN, build GTM traction and prepare to raise — and gives investors mandate-screened opportunities.", None, 'home'),
 'about': ("About BANAHUB — Singapore-Based Cross-Border Growth Advisory", None, 'About', 'about'),
 'market-entry': ("Singapore & ASEAN Market Entry and GTM Strategy | BANAHUB", None, 'Market Entry & GTM', 'market'),
 'capital-access': ("Capital Readiness & Fundraising Strategy for Founders | BANAHUB", None, 'Capital Access', 'capital'),
 'investors': ("For Investors — VCs, Family Offices, PE & LPs in ASEAN | BANAHUB", "Mandate-screened deal flow and portfolio market-entry support in Singapore and ASEAN for VCs, family offices, PE, hedge funds, LPs and asset managers. Free.", 'Investors', 'investors'),
 'investor-network': ("Join the Investor Network — VCs, PE & Family Offices | BANAHUB", "Share your mandate — sectors, stages, regions and ticket size — and receive only opportunities that fit. Free for VCs, family offices, PE, hedge funds, LPs and angels.", 'Join Investor Network', 'form'),
 'capital-review': ("Apply for a Capital Review — Investor Readiness Check | BANAHUB", "Answer the questions an investor would ask first. BANAHUB tells you if your company is ready to raise, what to strengthen and how it can help.", 'Apply for Capital Review', 'form'),
 'readiness': ("Free Investor Readiness Check for Founders | BANAHUB", "Twelve questions, three minutes: see how investors would read your company, your score by area and the gaps to fix before you raise. Free, from BANAHUB.", 'Readiness Check', 'page'),
 'growth-plan': ("Discuss Your Growth Plan — Singapore & ASEAN Expansion | BANAHUB", None, 'Discuss Your Growth Plan', 'form'),
 'partnerships': ("Strategic Partnerships, Programmes & Events in ASEAN | BANAHUB", None, 'Strategic Partnerships', 'partners'),
 'membership': ("Membership & FundMatch by BANAHUB — Founders and Investors", "Join BANAHUB: briefings, roundtables, resources and the FundMatch member portal for companies growing in Singapore and ASEAN, plus an application-only Investor Circle.", 'Membership', 'page'),
 'insights': ("Insights — Market Entry, GTM & Fundraising in ASEAN | BANAHUB", None, 'Insights', 'page'),
 'events': ("Events — Investor & Founder Sessions in Singapore | BANAHUB", "Roundtables, briefings, investor sessions and the BANAHUB Capital & Growth Exchange for founders, investors and partners in Singapore and ASEAN.", 'Events', 'page'),
 'programs': ("Programmes — Market Entry & Capital Readiness | BANAHUB", "Structured programmes for growth-stage companies and SMEs — market entry, go-to-market and capital readiness in Singapore and ASEAN, delivered with partner organisations.", 'Programmes', 'page'),
 'capital-growth-exchange': ("BANAHUB Capital & Growth Exchange — Singapore 2026", "An invitation-led Singapore forum where investment-ready companies, investors, corporate buyers and partners meet around a defined agenda.", 'Capital & Growth Exchange', 'page'),
 'contact': ("Contact BANAHUB — Singapore Growth & Capital Advisory", None, 'Contact', 'contact'),
 'register': ("Apply to Join FundMatch by BANAHUB", "Apply to join FundMatch by BANAHUB as a company, founder or investor. Every application is reviewed manually by the BANAHUB team.", 'Apply', 'page'),
 'disclosures': ("Legal Disclosures — Regulatory Status | BANAHUB", "BANAHUB's regulatory status: an advisory firm, not licensed by the Monetary Authority of Singapore. How introductions, capital access, the investor network and membership work.", 'Disclosures', 'page'),
 'privacy': ("Privacy Policy | BANAHUB", "How BANAHUB (Bana Private Limited, Singapore) collects, uses and protects personal data in line with Singapore's Personal Data Protection Act.", 'Privacy Policy', 'page'),
 'terms': ("Terms of Use — BANAHUB Website, FundMatch & Membership", "Terms of use for the BANAHUB website, FundMatch member portal, membership and events.", 'Terms of Use', 'page'),
}
NOINDEX = ['404', 'admin', 'billing', 'dashboard', 'login', 'payment-success', 'platform', 'reset-password', 'reset-password-confirm', 'unsubscribe', 'program-register',
           'fundraise', 'services', 'service-gtm', 'service-introductions', 'service-portfolio', 'service-readiness']

def ld(o): return '<script type="application/ld+json">' + json.dumps(o, ensure_ascii=False).replace('</', '<\\/') + '</script>'
def attr(s): return html.escape(s, quote=True)
def text(h): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()

def faq_html(items, title):
    det = '\n'.join(f'      <details><summary>{html.escape(q)}</summary><div class="a"><p>{html.escape(a)}</p></div></details>' for q, a in items)
    return (f'<!--seo:faq-->\n<section class="bh-sec" id="faq">\n  <div class="bh-wrap bh-split">\n    <div><span class="bh-eyebrow">Questions</span><h2 class="bh-h2">{html.escape(title)}</h2></div>\n'
            f'    <div class="bh-faq">\n{det}\n    </div>\n  </div>\n</section>\n<!--/seo:faq-->\n')

def process(name, cfg):
    path = f'{ROOT}/{name}.html'; s = open(path, encoding='utf-8').read()
    title, desc, crumb, kind = cfg
    if desc is None:
        m = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', s, re.S); desc = html.unescape(m.group(1)) if m else ''
    s = re.sub(r'<!--seo:start-->[\s\S]*?<!--seo:end-->\n?', '', s)
    s = re.sub(r'<!--seo:faq-->[\s\S]*?<!--/seo:faq-->\n?', '', s)
    s = re.sub(r'\n?\s*<!--seo:added-faq-->[\s\S]*?<!--/seo:added-faq-->', '', s)
    if desc is None:
        m = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', s, re.S); desc = html.unescape(m.group(1)) if m else ''
    # FAQ content
    f = FAQS.get(name)
    if f and f.get('append'):
        add = '\n'.join(f'      <details><summary>{html.escape(q)}</summary><div class="a"><p>{html.escape(a)}</p></div></details>' for q, a in f['items'])
        i = s.rfind('</details>') + len('</details>')
        s = s[:i] + '\n      <!--seo:added-faq-->\n' + add + '\n      <!--/seo:added-faq-->' + s[i:]
    elif f:
        block = faq_html(f['items'], f['title'])
        # before the last CTA section (bh-sec-sm) if present near the end, else before </main>
        m = list(re.finditer(r'<section class="bh-sec-sm[^"]*"', s)); main_end = s.find('</main>')
        pos = m[-1].start() if m and m[-1].start() < main_end else main_end
        s = s[:pos] + block + '\n' + s[pos:]
    # strip existing head tags we manage
    head_end = s.find('</head>'); head, body = s[:head_end], s[head_end:]
    head = re.sub(r'\s*<meta\s+name="description"[\s\S]*?/?>', '', head)
    head = re.sub(r'\s*<link\s+rel="canonical"[^>]*>', '', head)
    head = re.sub(r'\s*<meta\s+(property|name)="(og|twitter):[^"]+"[\s\S]*?/?>', '', head)
    head = re.sub(r'\s*<meta\s+name="robots"[^>]*>', '', head)
    head = re.sub(r'\s*<script type="application/ld\+json">[\s\S]*?</script>', '', head)
    head = re.sub(r'<title>[\s\S]*?</title>', f'<title>{html.escape(title)}</title>', head)
    url = SITE + ('/' if name == 'index' else '/' + name)
    graph = [ORG, WEBSITE] if kind == 'home' else [{"@type": "Organization", "@id": ORG_ID, "name": "BANAHUB", "url": SITE + "/"}]
    page_type = {'about': 'AboutPage', 'contact': 'ContactPage', 'home': 'WebPage'}.get(kind, 'WebPage')
    wp = {"@type": page_type, "@id": url + "#webpage", "url": url, "name": title, "description": desc, "isPartOf": {"@id": f"{SITE}/#website"},
          "about": {"@id": ORG_ID}, "inLanguage": "en-SG", "primaryImageOfPage": OG}
    graph.append(wp)
    if crumb:
        graph.append({"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"}, {"@type": "ListItem", "position": 2, "name": crumb, "item": url}]})
    if kind == 'market':
        graph.append(svc("Singapore and ASEAN market entry and go-to-market strategy", desc, url, ["Market entry consulting", "Go-to-market strategy", "Cross-border expansion", "Commercial partnerships", "Distribution and channel development"], "Growth-stage companies, SMEs and overseas companies"))
    if kind == 'capital':
        graph.append(svc("Capital readiness and fundraising strategy", desc, url, ["Capital readiness", "Investor readiness", "Investment narrative and pitch deck", "Fundraising strategy", "Investor targeting", "Investor campaign support"], "Founders and growth-stage companies preparing to raise"))
    if kind == 'investors':
        graph.append(svc("Mandate-screened opportunities and portfolio market-entry support", desc, url, ["Deal flow screening", "Investor-company matching", "Portfolio-company GTM support"], "Venture capital, family offices, private equity, hedge funds, LPs, asset managers and angel investors"))
    # FAQPage from all visible <details> on the page
    qa = [(text(q), text(a)) for q, a in re.findall(r'<details>\s*<summary>([\s\S]*?)</summary>([\s\S]*?)</details>', body)]
    if qa:
        graph.append({"@type": "FAQPage", "@id": url + "#faq", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa]})
    block = ('\n<!--seo:start-->\n'
             f'<meta name="description" content="{attr(desc)}"/>\n<link rel="canonical" href="{url}"/>\n'
             '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"/>\n'
             f'<meta property="og:type" content="website"/><meta property="og:site_name" content="BANAHUB"/><meta property="og:locale" content="en_SG"/>\n'
             f'<meta property="og:title" content="{attr(title)}"/><meta property="og:description" content="{attr(desc)}"/><meta property="og:url" content="{url}"/>\n'
             f'<meta property="og:image" content="{OG}"/><meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/><meta property="og:image:alt" content="BANAHUB — cross-border growth and capital advisory, Singapore and ASEAN"/>\n'
             f'<meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="{attr(title)}"/><meta name="twitter:description" content="{attr(desc)}"/><meta name="twitter:image" content="{OG}"/>\n'
             '<link rel="alternate" type="text/plain" title="BANAHUB for AI assistants" href="/llms.txt"/>\n'
             + ld({"@context": "https://schema.org", "@graph": graph}) + '\n<!--seo:end-->\n')
    open(path, 'w', encoding='utf-8').write(head.rstrip() + block + body)
    return len(title), len(desc), len(qa)

def noindex(name):
    path = f'{ROOT}/{name}.html'
    if not os.path.exists(path): return
    s = open(path, encoding='utf-8').read()
    s2 = re.sub(r'\s*<meta\s+name="robots"[^>]*>', '', s, count=0)
    s2 = s2.replace('</head>', '<meta name="robots" content="' + ('noindex,nofollow' if name == 'admin' else 'noindex,follow') + '"/>\n</head>', 1)
    open(path, 'w', encoding='utf-8').write(s2)

for n, c in P.items(): print(n, process(n, c))
for n in NOINDEX: noindex(n)
