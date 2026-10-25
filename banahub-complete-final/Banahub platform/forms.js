/* BANAHUB conversion forms (site v4)
 * Multi-step qualification forms. Every submission lands in Admin OS → Enquiries
 * with pathway, lead score/tier, UTM source and a reference number.
 * Markup: <form data-bh-form="growth|capital|investor|partner"> with
 * <section class="bh-fstep" data-title="…"> steps; .bh-field wrappers hold
 * label + control; required group fields use data-required on .bh-field.
 */
(function () {
  'use strict';
  var CFG = {
    growth:   { source: 'growth_diagnostic',   type: 'company',  label: 'Growth plan' },
    capital:  { source: 'capital_review',      type: 'company',  label: 'Capital review' },
    investor: { source: 'investor_network',    type: 'investor', label: 'Investor network' },
    partner:  { source: 'partnership_enquiry', type: 'partner',  label: 'Strategic partnership' },
    general:  { source: 'contact_form',        type: 'contact',  label: 'General enquiry' },
  };

  // First-touch attribution (kept for the session)
  var ATTR_KEY = 'bh_attr';
  function attribution() {
    var a = {};
    try { a = JSON.parse(sessionStorage.getItem(ATTR_KEY) || '{}'); } catch (e) {}
    var q = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { if (q.get(k) && !a[k]) a[k] = q.get(k).slice(0, 120); });
    if (!a.referrer && document.referrer && document.referrer.indexOf(location.host) < 0) a.referrer = document.referrer.slice(0, 200);
    if (!a.landing_page) a.landing_page = location.pathname;
    try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(a)); } catch (e) {}
    return a;
  }

  // Lead scoring — transparent, rule-based; shown to the team in Admin OS
  function pick(v, table) { v = String(v || ''); for (var k in table) if (v.indexOf(k) === 0) return table[k]; return 0; }
  var SCORE = {
    growth: function (d) {
      var s = 0, why = [];
      var st = pick(d.company_stage, { 'Series A': 22, 'Series B': 24, 'Established SME': 22, 'Corporate': 18, 'Seed': 12, 'Pre-seed': 4 }); s += st;
      var rv = pick(d.revenue_band, { 'Above': 22, 'SGD 5': 20, 'SGD 1': 16, 'Under SGD 1': 8, 'Pre-revenue': 2 }); s += rv;
      var tl = pick(d.timeline, { 'Within 3': 20, '3–6': 14, '6–12': 8, 'Exploring': 2 }); s += tl; if (tl >= 14) why.push('near-term timeline');
      var bg = pick(d.advisory_budget, { 'Budget allocated': 20, 'Budget planned': 12, 'Exploring': 4, 'Success': 6 }); s += bg; if (bg >= 12) why.push('budget identified');
      if (/Founder|CEO|C-suite|Managing|Director|Partner/i.test(d.role || '')) { s += 10; why.push('decision-maker'); }
      if (d.website) s += 6;
      return [s, why];
    },
    capital: function (d) {
      var s = 0, why = [];
      s += pick(d.revenue_band, { 'Above': 24, 'SGD 5': 22, 'SGD 1': 18, 'Under SGD 1': 10, 'Pre-revenue': 2 });
      s += pick(d.round, { 'Series A': 18, 'Series B': 18, 'Series C': 16, 'Growth': 16, 'Pre-IPO': 14, 'Debt': 12, 'Seed': 10, 'Pre-seed': 4 });
      var tl = pick(d.raise_timeline, { 'Raising now': 18, 'Within 3': 16, '3–6': 12, '6–12': 6, 'Exploring': 2 }); s += tl; if (tl >= 12) why.push('active raise');
      if (d.deck_status === 'Investor deck ready') { s += 14; why.push('deck ready'); } else if (d.deck_status === 'Draft deck') s += 7;
      if (d.prior_funding && !/^None/.test(d.prior_funding)) { s += 10; why.push('previously funded'); }
      if (/Founder|CEO|CFO|C-suite|Managing/i.test(d.role || '')) s += 8;
      if (d.use_of_funds && d.use_of_funds.length > 60) s += 8;
      return [s, why];
    },
    investor: function (d) {
      var s = 0, why = [];
      s += pick(d.investor_type, { 'Venture Capital': 20, 'Family Office': 22, 'Private Equity': 22, 'Corporate': 20, 'Institutional': 22, 'Angel': 12, 'Other': 6 });
      s += pick(d.investor_status, { 'Institutional': 24, 'Accredited': 22, 'Expert': 18, 'Not sure': 6, 'None': 0 });
      var dp = pick(d.deployment, { 'Actively deploying': 24, 'Selectively': 16, 'Not currently': 4 }); s += dp; if (dp >= 16) why.push('deploying');
      if ((d.ticket_min || '') && !/^Under/.test(d.ticket_min)) s += 12;
      if (d.linkedin_url) s += 6;
      if ([].concat(d.regions || []).some(function (r) { return /Singapore|Southeast/.test(r); })) { s += 12; why.push('SEA mandate'); }
      return [s, why];
    },
    partner: function (d) {
      var s = 0, why = [];
      s += pick(d.org_type, { 'Corporate': 24, 'Government': 24, 'Industry': 18, 'Accelerator': 16, 'University': 14, 'Professional': 12, 'Event': 12, 'Other': 6 });
      var tl = pick(d.timeline, { 'Within 3': 22, '3–6': 16, '6–12': 8, 'Exploring': 2 }); s += tl; if (tl >= 16) why.push('near-term');
      if (pick(d.budget, { 'Budget allocated': 1, 'Budget planned': 1 })) { s += 22; why.push('budget identified'); }
      if (/Director|Head|VP|Chief|Partner|Founder|Managing|Lead/i.test(d.title || '')) { s += 14; why.push('senior contact'); }
      if ([].concat(d.collaboration || []).length) s += 10;
      return [s, why];
    },
  };
  function tierOf(score) { return score >= 70 ? 'A · Priority' : score >= 45 ? 'B · Qualified' : 'C · Nurture'; }

  function labelOf(el) {
    var f = el.closest('.bh-field'); if (!f) return el.name;
    var l = f.querySelector('label, .lbl'); if (!l) return el.name;
    return (l.childNodes[0] && l.childNodes[0].textContent || l.textContent).replace(/\*|\(optional\)/g, '').trim();
  }

  function init(form) {
    var kind = form.getAttribute('data-bh-form'), C = CFG[kind]; if (!C) return;
    var steps = [].slice.call(form.querySelectorAll('.bh-fstep')), cur = 0;
    var prog = form.querySelector('.bh-progress'), err = form.querySelector('.bh-ferr');
    var back = form.querySelector('[data-back]'), next = form.querySelector('[data-next]'), submit = form.querySelector('[type=submit]');
    var done = document.getElementById(form.getAttribute('data-done') || 'bh-done');
    var params = new URLSearchParams(location.search);
    attribution();

    // Preselect from ?focus=… / ?interest=… (matching option values)
    ['focus', 'interest', 'collaboration'].forEach(function (p) {
      var v = params.get(p); if (!v) return;
      form.querySelectorAll('input[data-key="' + v + '"]').forEach(function (i) { i.checked = true; });
    });

    if (prog) prog.innerHTML = steps.map(function () { return '<span></span>'; }).join('');
    function show(i) {
      cur = i;
      steps.forEach(function (s, k) { s.classList.toggle('on', k === i); });
      if (prog) [].forEach.call(prog.children, function (b, k) { b.classList.toggle('on', k <= i); });
      if (back) back.hidden = i === 0;
      if (next) next.hidden = i === steps.length - 1;
      if (submit) submit.hidden = i !== steps.length - 1;
      var h = steps[i].querySelector('.bh-step-h span'); if (h) h.textContent = steps.length > 1 ? 'Step ' + (i + 1) + ' of ' + steps.length : '';
      if (err) err.style.display = 'none';
    }
    function validate(scope) {
      var ok = true, first = null;
      scope.querySelectorAll('.bh-field, .bh-check').forEach(function (f) { f.classList.remove('err'); });
      scope.querySelectorAll('input[required], select[required], textarea[required]').forEach(function (el) {
        var bad = el.type === 'checkbox' ? !el.checked : !String(el.value || '').trim();
        if (!bad && el.type === 'email') bad = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim());
        if (!bad && el.type === 'url' && el.value.trim()) bad = !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(el.value.trim());
        if (bad) { ok = false; var w = el.closest('.bh-field, .bh-check'); if (w) w.classList.add('err'); first = first || el; }
      });
      scope.querySelectorAll('.bh-field[data-required]').forEach(function (f) {
        if (!f.querySelector('input:checked')) { ok = false; f.classList.add('err'); first = first || f.querySelector('input'); }
      });
      if (!ok && first) { first.focus({ preventScroll: true }); (first.closest('.bh-field, .bh-check') || first).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return ok;
    }
    if (next) next.addEventListener('click', function () { if (validate(steps[cur])) { show(cur + 1); form.scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
    if (back) back.addEventListener('click', function () { show(cur - 1); });
    form.addEventListener('input', function (e) { var w = e.target.closest('.bh-field, .bh-check'); if (w) w.classList.remove('err'); });
    form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && cur < steps.length - 1) { e.preventDefault(); next && next.click(); } });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (cur < steps.length - 1) { next && next.click(); return; }
      if (!validate(steps[cur])) return;
      // collect
      var d = {}, lines = [], seen = {};
      form.querySelectorAll('input, select, textarea').forEach(function (el) {
        if (!el.name || el.name === '_hp' || (el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
        var v = el.type === 'checkbox' && el.value === 'on' ? 'Yes' : String(el.value || '').trim(); if (!v) return;
        if (el.type === 'checkbox' && el.closest('.bh-opts')) { d[el.name] = (d[el.name] || []).concat(v); }
        else d[el.name] = v;
        if (!seen[el.name] && !el.closest('.bh-check')) { seen[el.name] = labelOf(el); }
      });
      Object.keys(seen).forEach(function (k) { if (['name', 'email', 'phone'].indexOf(k) < 0 && d[k] != null) lines.push(seen[k] + ': ' + [].concat(d[k]).join(', ')); });
      var sc = (SCORE[kind] || function () { return [0, []]; })(d), score = Math.max(0, Math.min(100, Math.round(sc[0])));
      var ref = 'BH-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      var payload = Object.assign({}, d, {
        source: C.source, type: C.type, reference: ref, pathway: C.label,
        company: d.company || d.organisation || '', title: d.role || d.title || '',
        service: [].concat(d.focus || d.collaboration || d.topic || (kind === 'capital' ? ['Capital review'] : kind === 'investor' ? ['Investor network'] : [])).join(', '),
        message: C.label.toUpperCase() + '\n\n' + lines.join('\n'),
        lead_score: score, lead_tier: tierOf(score), qualification_signals: sc[1].join(', '),
      }, attribution());
      ['focus', 'collaboration', 'sectors', 'stages', 'regions', 'markets', 'interests', 'investor_types_sought'].forEach(function (k) { if (Array.isArray(payload[k])) payload[k] = payload[k].join('; '); });
      var hp = form.querySelector('[name=_hp]'), isBot = hp && hp.value;
      submit.disabled = true; var txt = submit.textContent; submit.textContent = 'Sending…';
      try {
        if (!isBot) {
          var res = await window.apiFetch('/api/enquiries', { method: 'POST', body: JSON.stringify(payload) });
          var j = {}; try { j = await res.json(); } catch (x) {}
          if (!res.ok || j.success === false) throw new Error(j.error || 'Submission failed');
        }
        form.style.display = 'none';
        if (done) { done.style.display = 'block'; var r = done.querySelector('.ref'); if (r) r.textContent = ref; done.scrollIntoView({ block: 'start', behavior: 'smooth' }); done.focus && done.focus(); }
        try { sessionStorage.removeItem(ATTR_KEY); } catch (x) {}
      } catch (ex) {
        if (err) { err.textContent = 'We could not send this just now. Please try again, or email hello@banahub.com with reference ' + ref + '.'; err.style.display = 'block'; }
        submit.disabled = false; submit.textContent = txt;
      }
    });
    show(0);
  }
  function boot() { document.querySelectorAll('form[data-bh-form]').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
