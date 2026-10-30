// BANAHUB shared navigation + footer (site v4)
// Usage: <div id="site-nav"></div> … <div id="site-footer"></div> <script src="nav.js"></script>
(function () {
  // Load the v4 stylesheet on every page that uses the shared nav
  if (!document.querySelector('link[href*="bh.css"]')) {
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/bh.css?v=4.3.0'; document.head.appendChild(l);
  }
  var page = (location.pathname.replace(/\/+$/, '').split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  var ITEMS = [
    ['index', 'Home', '/index.html'],
    ['market-entry', 'Market Entry & GTM', '/market-entry.html'],
    ['capital-access', 'Capital Access', '/capital-access.html'],
    ['investors', 'Investors', '/investors.html'],
    ['partnerships', 'Strategic Partnerships', '/partnerships.html'],
    ['insights', 'Insights & Events', '/insights.html', ['events', 'event', 'programs', 'capital-growth-exchange']],
    ['membership', 'Membership', '/membership.html', ['billing']],
    ['about', 'About', '/about.html'],
  ];
  function isOn(it) { return page === it[0] || (it[3] || []).indexOf(page) >= 0 || (page === 'capital-review' && it[0] === 'capital-access') || (page === 'investor-network' && it[0] === 'investors'); }

  var navEl = document.getElementById('site-nav');
  if (navEl) {
    navEl.innerHTML =
      '<header class="bh-nav" role="banner"><div class="bh-wrap bh-nav-in">' +
        '<a href="/index.html" class="bh-logo" aria-label="BANAHUB home"><img src="/logo-icon-512.png" alt="" width="30" height="30"/><span>BANAHUB<small>SINGAPORE</small></span></a>' +
        '<nav aria-label="Main"><ul class="bh-menu">' + ITEMS.map(function (it) {
          return '<li><a href="' + it[2] + '"' + (isOn(it) ? ' class="on" aria-current="page"' : '') + '>' + it[1].replace('&', '&amp;') + '</a></li>';
        }).join('') + '</ul></nav>' +
        '<div class="bh-nav-cta"><a href="/login.html" class="bh-signin">Sign in</a><a href="/growth-plan.html" class="bh-btn bh-btn-primary bh-btn-sm">Discuss Your Growth Plan</a></div>' +
        '<button type="button" class="bh-burger" id="bh-burger" aria-label="Open menu" aria-expanded="false" aria-controls="bh-drawer"><span class="material-symbols-outlined" aria-hidden="true">menu</span></button>' +
      '</div>' +
      '<div class="bh-drawer" id="bh-drawer">' + ITEMS.map(function (it) {
          return '<a class="item' + (isOn(it) ? ' on' : '') + '" href="' + it[2] + '">' + it[1].replace('&', '&amp;') + '<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></a>';
        }).join('') +
        '<div class="bh-actions"><a href="/growth-plan.html" class="bh-btn bh-btn-primary">Discuss Your Growth Plan</a><a href="/capital-review.html" class="bh-btn bh-btn-secondary">Apply for Capital Review</a><a href="/investor-network.html" class="bh-btn bh-btn-secondary">Join Investor Network</a><a href="/login.html" class="bh-btn bh-btn-secondary">Member sign in</a></div>' +
      '</div></header>';
    var btn = document.getElementById('bh-burger'), drawer = document.getElementById('bh-drawer');
    btn.addEventListener('click', function () {
      var open = drawer.classList.toggle('open');
      btn.setAttribute('aria-expanded', open); btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      btn.firstChild.textContent = open ? 'close' : 'menu';
      document.body.classList.toggle('bh-locked', open);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('open')) btn.click(); });
  }

  // Mobile sticky CTA (not on form, auth or member pages)
  var NO_MCTA = ['growth-plan', 'capital-review', 'investor-network', 'login', 'register', 'dashboard', 'reset-password', 'reset-password-confirm', 'payment-success', 'contact', 'membership', 'billing'];
  if (navEl && NO_MCTA.indexOf(page) < 0 && !document.body.hasAttribute('data-no-mcta')) {
    var m = document.createElement('div'); m.className = 'bh-mcta';
    m.innerHTML = page === 'investors'
      ? '<a href="/investor-network.html" class="bh-btn bh-btn-primary">Join Investor Network</a>'
      : page === 'capital-access'
        ? '<a href="/capital-review.html" class="bh-btn bh-btn-primary">Apply for Capital Review</a>'
        : '<a href="/growth-plan.html" class="bh-btn bh-btn-primary">Discuss Your Growth Plan</a>';
    document.body.appendChild(m); document.body.classList.add('bh-has-mcta');
  }

  var footerEl = document.getElementById('site-footer');
  if (footerEl) {
    footerEl.innerHTML =
      '<footer class="bh-foot" role="contentinfo"><div class="bh-wrap">' +
        '<div class="bh-foot-top">' +
          '<div><div class="brand">BANAHUB</div><p style="margin-top:12px;max-width:340px">Singapore-based cross-border growth, market access and capital advisory for growth-stage companies, investors and ecosystem partners.</p>' +
          '<p style="margin-top:14px">Bana Private Limited<br/>UEN 201933473Z · Singapore<br/><a href="mailto:hello@banahub.com">hello@banahub.com</a></p></div>' +
          '<div><h4>Companies</h4><ul><li><a href="/market-entry.html">Market Entry &amp; GTM</a></li><li><a href="/capital-access.html">Capital Access</a></li><li><a href="/growth-plan.html">Discuss Your Growth Plan</a></li><li><a href="/capital-review.html">Apply for Capital Review</a></li></ul></div>' +
          '<div><h4>Investors</h4><ul><li><a href="/investors.html">For Investors</a></li><li><a href="/investor-network.html">Join Investor Network</a></li><li><a href="/growth-plan.html?focus=portfolio">Portfolio Advisory</a></li></ul></div>' +
          '<div><h4>Partners</h4><ul><li><a href="/partnerships.html">Strategic Partnerships</a></li><li><a href="/partnerships.html#partner-form">Propose a Collaboration</a></li><li><a href="/programs.html">Programmes</a></li><li><a href="/insights.html#events">Events</a></li></ul></div>' +
          '<div><h4>Company</h4><ul><li><a href="/about.html">About</a></li><li><a href="/insights.html">Insights</a></li><li><a href="/contact.html">Contact</a></li><li><a href="/membership.html">Membership</a></li><li><a href="/login.html">Member sign in</a></li></ul></div>' +
        '</div>' +
        '<div class="bh-foot-legal"><p>BANAHUB provides advisory services only. Bana Private Limited is not licensed by the Monetary Authority of Singapore as a financial adviser, capital markets services licensee or exempt financial institution, and does not provide financial advice, make investment recommendations, deal in securities or arrange the offer of securities. Nothing on this website is an offer or solicitation to buy or sell any security. Investor introductions are made only to parties who meet applicable eligibility requirements, and do not guarantee any investment, meeting or commercial outcome. Any success fee is payable only where contractually agreed and permitted by law. See <a href="/disclosures.html">Disclosures</a>.</p>' +
        '<div class="bh-foot-bottom"><span>© ' + new Date().getFullYear() + ' Bana Private Limited. All rights reserved.</span><span><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/disclosures.html">Disclosures</a></span></div></div>' +
      '</div></footer>';
  }
})();
