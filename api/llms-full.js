// /llms-full.txt — everything an AI assistant needs to describe BANAHUB accurately, including live insights, events and programmes.
const L = require('./_lib');
const FAQS = require('./_faqs.json');

const SERVICES = `## Services in detail

### Market Entry & GTM — ${L.SITE}/market-entry
For companies with a proven product entering Singapore, or expanding from Singapore into ASEAN.
- Singapore market entry: opportunity assessment, competitor positioning, entry model and set-up options, launch plan with milestones.
- ASEAN market entry: market prioritisation across Malaysia, Indonesia, Vietnam, Thailand and the Philippines; country-specific entry approach; phased roll-out.
- Go-to-market strategy: ideal customer profile, segmentation, positioning, pricing approach, sales and channel model.
- Cross-border expansion: regional operating model, hiring and resourcing, expansion budget and KPIs.
- Commercial partnerships: partner long-list and shortlist, outreach and meeting support, partnership term outline.
- Distribution and channel development: channel strategy, distributor selection and onboarding, performance framework.
Process: Diagnose → Decide → Build → Scale. BANAHUB coordinates with licensed legal, tax and corporate-secretarial providers rather than acting in their place.

### Capital Access — ${L.SITE}/capital-access
For growth-stage companies preparing to raise (pre-seed to pre-IPO, including debt).
- Capital readiness review: traction evidence, unit economics, team, governance, data room and valuation expectations, with a prioritised gap list.
- Investment narrative: equity story, investor deck and supporting materials.
- Fundraising strategy: round sizing, timing, investor mix and process plan.
- Investor targeting: investors whose stated mandate (stage, sector, geography, ticket size) fits the round.
- Investor campaign support: outreach sequencing, meeting preparation, pipeline tracking.
- Eligible investor introductions: only to investors meeting eligibility requirements, only with the company's consent. Success fees only where contractually agreed and permitted by law.
Apply: ${L.SITE}/capital-review

### For investors — ${L.SITE}/investors
For VCs, corporate venture, angels, family offices, multi-family offices, private equity, hedge funds, fund of funds, LPs, institutional investors and asset managers.
- Opportunities screened against the investor's sector, stage, geography and ticket size; anonymised brief first, full materials only with the company's consent.
- Portfolio growth support: market entry plans, GTM execution, leadership advisory and follow-on readiness for portfolio companies entering Singapore and ASEAN.
- Private sessions and roundtables, where scheduled.
- Joining the investor network is free with no obligation: ${L.SITE}/investor-network

### Growth Advisory
Founder and C-suite advisory, portfolio-company GTM, international growth strategy, strategic partnership development and commercial execution.

### Strategic partnerships — ${L.SITE}/partnerships
Strategic partnerships, market-access programmes for cohorts, event collaborations and corporate venturing / startup sourcing with corporates, agencies, trade bodies, accelerators, universities and service firms.

### FundMatch by BANAHUB and membership — ${L.SITE}/membership
FundMatch by BANAHUB is the member platform where approved companies and investors keep profiles (sector, stage, geography, ticket size, pitch decks) used for mandate matching. Company memberships provide briefings, roundtables, programme access and resources; the Investor Circle is application-only for professional investors. Membership is approved manually and does not include or buy investor introductions, investment opportunities, fundraising outcomes or financial advice.
`;

const DOES = `## How BANAHUB works
BANAHUB does: scope engagements with defined outputs before work begins; give an honest assessment of readiness and fit; prepare companies for investor conversations; introduce counterparties only where mandates and eligibility align; coordinate with licensed legal, tax and corporate providers.
BANAHUB does not: guarantee capital, investor meetings or commercial outcomes; act as a licensed financial adviser, broker or placement agent; publish unverified metrics about its network or track record; share client information without consent.
`;

module.exports = async (req, res) => {
  let head = '';
  try { head = await L.template(req, 'llms.txt'); } catch (_) { head = `# BANAHUB\n\n> Singapore-based cross-border growth advisory firm (Bana Private Limited, UEN 201933473Z). ${L.SITE}\n`; }
  const O = await L.org();
  const prof = (O.sameAs || []).length ? `## Official profiles\n${O.sameAs.map((u) => '- ' + u).join('\n')}\n` : '';
  const d = await L.published().catch(() => ({ articles: [], events: [], programs: [] }));
  const day = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '');
  const faq = Object.values(FAQS).flatMap((p) => p.items).map(([q, a]) => `### ${q}\n${a}\n`).join('\n');
  const arts = d.articles.slice(0, 40).map((a) => `### ${a.title}\n${L.artUrl(a)} · ${day(a.publish_date || a.created_at)}${a.category ? ' · ' + a.category : ''}\n${L.clip(L.strip(a.meta_description || a.body), 900)}\n`).join('\n');
  const now = new Date();
  const evs = d.events.filter((e) => !e.event_date || new Date(e.event_date) >= now).slice(0, 20)
    .map((e) => `- ${e.title} — ${e.event_date ? day(e.event_date) : 'date TBA'}${e.location ? ', ' + e.location : ''}: ${L.evUrl(e)}`).join('\n');
  const progs = (d.programs || []).filter((p) => p.status !== 'closed').slice(0, 20)
    .map((p) => `- ${p.title}${p.region ? ' (' + p.region + ')' : ''}${p.start_date ? ', starts ' + day(p.start_date) : ''}: ${L.clip(L.strip(p.description), 240)}`).join('\n');
  const txt = [head.trim(), '', SERVICES, DOES, prof,
    '## Frequently asked questions\n\n' + faq,
    arts ? '## Latest insights\n\n' + arts : '',
    evs ? `## Upcoming events\n${evs}\nAll events: ${L.SITE}/events\n` : '',
    progs ? `## Programmes\n${progs}\nAll programmes: ${L.SITE}/programs\n` : '',
    `---\nLast updated: ${day(now)}. Source of truth: ${L.SITE}. Contact: hello@banahub.com.`].filter(Boolean).join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
  res.end(txt);
};
