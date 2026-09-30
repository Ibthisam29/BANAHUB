// Shared navigation and footer injected into every public page
// Usage: <script src="nav.js"></script> at bottom of body
// Expects: <div id="site-nav"></div> and <div id="site-footer"></div>

(function() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  function active(href) { return current === href ? 'active' : ''; }

  // ── Navigation ──────────────────────────────────────────────
  const navEl = document.getElementById('site-nav');
  if (navEl) {
    navEl.innerHTML = `
      <nav class="site-nav" role="navigation" aria-label="Main navigation">
        <div class="container nav-inner">
          <a href="index.html" class="nav-logo" aria-label="BANAHub — Home">
            <img src="logo-icon-512.png" alt="" width="28" height="28"/>
            BANAHUB
          </a>

          <ul class="nav-links" id="nav-links-list" role="list">
            <li class="nav-dropdown">
              <button aria-haspopup="true" aria-expanded="false" id="nav-services-btn">
                Services <span class="material-symbols-outlined" style="font-size:16px;opacity:.6">expand_more</span>
              </button>
              <ul class="nav-dropdown-menu" role="menu" aria-labelledby="nav-services-btn">
                <li><a href="services.html" role="menuitem">Overview</a></li>
                <li><a href="service-gtm.html" role="menuitem">GTM &amp; Market Entry</a></li>
                <li><a href="service-readiness.html" role="menuitem">Investor Readiness</a></li>
                <li><a href="service-introductions.html" role="menuitem">Investor Introductions</a></li>
                <li><a href="service-portfolio.html" role="menuitem">Portfolio Advisory</a></li>
              </ul>
            </li>
            <li><a href="programs.html" class="${active('programs.html')}">Programs</a></li>
            <li><a href="events.html" class="${active('events.html')}">Events</a></li>
            <li><a href="about.html" class="${active('about.html')}">About</a></li>
            <li><a href="insights.html" class="${active('insights.html')}">Insights</a></li>
            <li><a href="contact.html" class="${active('contact.html')}">Contact</a></li>
          </ul>

          <div class="nav-cta">
            <a href="login.html" class="btn btn-ghost btn-sm">Sign In</a>
            <a href="contact.html" class="btn btn-primary btn-sm">Book a Call</a>
          </div>

          <button class="nav-mob-toggle" id="mob-toggle" aria-label="Open navigation menu" aria-controls="nav-links-list" aria-expanded="false">
            <span class="material-symbols-outlined" aria-hidden="true">menu</span>
          </button>
        </div>
      </nav>`;

    // Mobile toggle
    const toggle = document.getElementById('mob-toggle');
    const nav = navEl.querySelector('.site-nav');
    toggle && toggle.addEventListener('click', function() {
      const open = nav.classList.toggle('nav-mobile-open');
      this.setAttribute('aria-expanded', open);
      this.querySelector('.material-symbols-outlined').textContent = open ? 'close' : 'menu';
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (!navEl.contains(e.target)) {
        nav.classList.remove('nav-mobile-open');
        toggle && toggle.setAttribute('aria-expanded', 'false');
        toggle && (toggle.querySelector('.material-symbols-outlined').textContent = 'menu');
      }
    });
  }

  // ── Footer ──────────────────────────────────────────────────
  const footerEl = document.getElementById('site-footer');
  if (footerEl) {
    footerEl.innerHTML = `
      <footer class="site-footer" role="contentinfo">
        <div class="container">
          <div class="footer-grid">
            <div>
              <p class="footer-logo">BANAHub</p>
              <p class="footer-tagline">GTM advisory, market expansion, and capital readiness for growth-stage companies across Southeast Asia, the Gulf, and North Asia.</p>
              <p style="margin-top:1.25rem;font-size:0.8125rem;color:rgba(255,255,255,0.40)">Bana Private Limited<br/>UEN 201933473Z · Singapore</p>
            </div>
            <div class="footer-col">
              <h4>Services</h4>
              <ul>
                <li><a href="services.html">Overview</a></li>
                <li><a href="service-gtm.html">GTM &amp; Market Entry</a></li>
                <li><a href="service-readiness.html">Investor Readiness</a></li>
                <li><a href="service-introductions.html">Investor Introductions</a></li>
                <li><a href="service-portfolio.html">Portfolio Advisory</a></li>
              </ul>
            </div>
            <div class="footer-col">
              <h4>Platform</h4>
              <ul>
                <li><a href="programs.html">Programs</a></li>
                <li><a href="events.html">Events</a></li>
                <li><a href="membership.html">Membership</a></li>
                <li><a href="fundraise.html">Raise Capital</a></li>
                <li><a href="insights.html">Insights</a></li>
              </ul>
            </div>
            <div class="footer-col">
              <h4>Company</h4>
              <ul>
                <li><a href="about.html">About</a></li>
                <li><a href="contact.html">Contact</a></li>
                <li><a href="privacy.html">Privacy Policy</a></li>
                <li><a href="terms.html">Terms of Use</a></li>
                <li><a href="disclosures.html">Disclosures</a></li>
              </ul>
            </div>
          </div>
          <div class="footer-bottom">
            <p>© ${new Date().getFullYear()} Bana Private Limited. All rights reserved.</p>
            <div class="footer-legal">
              <a href="privacy.html">Privacy</a>
              <a href="terms.html">Terms</a>
              <a href="disclosures.html">Disclosures</a>
              <a href="mailto:hello@banahub.com">hello@banahub.com</a>
            </div>
          </div>
        </div>
      </footer>`;
  }
})();
