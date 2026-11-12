// /events/:slug — event page with server-rendered meta, Event schema and a readable summary (the page's JS still adds registration).
const L = require('./_lib');

module.exports = async (req, res) => {
  const key = String(req.query.slug || '').slice(0, 200);
  let html;
  try {
    html = await L.template(req, 'event.html');
    const col = /^[0-9a-f-]{36}$/i.test(key) ? 'id' : 'slug';
    const rows = key ? await L.sb(`events?select=*&published=eq.true&${col}=eq.${encodeURIComponent(key)}&limit=1`) : [];
    const e = rows[0];
    if (e) {
      const url = L.evUrl(e), desc = L.clip(L.strip(e.description) || `${e.title} — a BANAHUB event in ${e.location || 'Singapore'}.`, 158);
      const online = /online|virtual|zoom/i.test(`${e.format} ${e.location}`);
      const when = e.event_date ? new Date(e.event_date).toLocaleString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' }) : 'Date to be announced';
      const O = await L.org();
      const ld = L.jsonld({
        '@context': 'https://schema.org', '@type': 'Event', name: e.title, description: desc, url,
        startDate: e.event_date || undefined, endDate: e.end_date || undefined,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: online ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
        location: online ? { '@type': 'VirtualLocation', url } : { '@type': 'Place', name: e.location || 'Singapore', address: { '@type': 'PostalAddress', addressLocality: e.location || 'Singapore', addressCountry: 'SG' } },
        image: e.cover_image ? [e.cover_image] : [`${L.SITE}/og-image.png`],
        organizer: O,
        offers: e.price_amount ? { '@type': 'Offer', price: Number(e.price_amount), priceCurrency: (e.currency || 'SGD').toUpperCase(), url: e.luma_url || e.registration_url || url, availability: 'https://schema.org/InStock' } : undefined,
        isAccessibleForFree: !e.price_amount,
      }) + L.jsonld(L.crumbs([['Home', L.SITE + '/'], ['Events', L.SITE + '/events'], [e.title, url]]));
      html = L.setHead(html, { title: `${e.title} | BANAHUB Events`, description: desc, url, image: e.cover_image, extra: ld + '\n' });
      const summary = `<div class="max-w-3xl mx-auto px-6 text-left"><p class="font-sans font-bold text-label-caps tracking-widest mb-3">${L.esc([e.type, e.format].filter(Boolean).join(' · ') || 'Event')}</p>` +
        `<h1 class="font-display text-display-sm mb-4">${L.esc(e.title)}</h1><p class="mb-2">${L.esc(when)}${e.location ? ' · ' + L.esc(e.location) : ''}</p>` +
        `<div class="space-y-3">${String(e.description || '').split(/\n\s*\n/).slice(0, 12).map((p) => `<p>${L.esc(p)}</p>`).join('')}</div></div>`;
      html = html.replace(/(<div id="ev-loading"[^>]*>)Loading event…(<\/div>)/, `$1${summary}$2`);
    } else if (key) {
      html = html.replace(/<meta name="robots"[^>]*>/g, '').replace('<head>', '<head>\n<meta name="robots" content="noindex"/>');
    }
  } catch (err) {
    if (!html) { res.statusCode = 302; res.setHeader('Location', `/event?slug=${encodeURIComponent(key)}`); return res.end(); }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
  res.end(html);
};
