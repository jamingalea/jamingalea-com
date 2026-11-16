/* Style: "classic" - the original look of the site, redrawn from the same content. */
(function () {
  var S = window.SiteStyles = window.SiteStyles || {}; S.q = S.q || [];
  var ARROW = '<svg class="arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5l7-7M3.5 2.5h6v6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  var ARROW_RIGHT = '<svg class="arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10M6.5 1.5L11 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  S.q.push({
    id: 'classic', label: 'Classic', css: '/styles/classic.css', bg: '#1a1a1a',
    fonts: ['300 18px Inter', '500 18px Inter'],
    render: function (m, H) {
      var h = H.h, root = h('div', { class: 'classic' });
      var tags = function (list) {
        return list.length ? h('ul', { class: 'tags' }, list.map(function (t) { return h('li', { class: 'tag' + (t.highlight ? ' tag--highlight' : ''), text: t.label }); })) : null;
      };
      var title = function (item, cls, arrow) {
        var el = h('h3', { class: cls });
        if (!item.href) el.textContent = item.title;
        else el.appendChild(h('a', Object.assign(H.linkAttrs(item), { html: esc(item.title) + arrow })));
        return el;
      };
      var box = function (cls, list) { var d = h('div', { class: cls }); H.paras(list).forEach(function (e) { d.appendChild(e); }); return d; };

      // data-flat: sticky in this style, so it's laid out flat while the glitch slices the page into bands
      var hero = h('header', { class: 'hero', 'data-flat': '' },
        h('div', { class: 'hero__intro', 'data-anchor-passive': 'intro' }, h('h1', { class: 'hero__name', text: m.name }), box('hero__tagline', m.tagline)),
        box('hero__bio', m.bio));
      root.appendChild(hero);

      var left = h('div', { class: 'work__col work__col--left' }), right = h('div', { class: 'work__col work__col--right' });
      m.projects.forEach(function (p) {
        var a = h('article', { class: 'project reveal', 'data-anchor': p.id });
        if (p.image) {
          var img = H.img(p.image);
          a.appendChild(p.caseStudy ? h('a', { class: 'project__media', href: p.href, tabindex: '-1' }, img) : h('div', { class: 'project__media' }, img));
        }
        var body = h('div', { class: 'project__body' }, title(p, 'project__title', p.caseStudy ? ARROW_RIGHT : ARROW), box('project__text', p.text));
        var t = tags(p.tags); if (t) body.appendChild(t);
        a.appendChild(body);
        (p.column === 'right' ? right : left).appendChild(a);
      });
      root.appendChild(h('main', {}, h('section', { class: 'work', 'aria-label': m.workTitle }, left, right)));

      if (m.highlights.length) {
        var track = h('ul', { class: 'ticker__track', style: '--count:' + m.highlights.length });
        m.highlights.forEach(function (x) {
          var li = h('li', { class: 'highlight', 'data-anchor': x.id });
          if (x.icon) li.appendChild(h('img', { class: 'highlight__icon', src: x.icon, alt: '', loading: 'lazy' }));
          li.appendChild(title(x, 'highlight__title', ARROW));
          li.appendChild(box('highlight__text', x.text));
          var t = tags(x.tags); if (t) li.appendChild(t);
          track.appendChild(li);
        });
        root.querySelector('main').appendChild(h('section', { class: 'highlights reveal', 'data-anchor': 'highlights', 'aria-label': m.highlightsTitle },
          h('h2', { class: 'section-title', text: m.highlightsTitle }), h('div', { class: 'ticker' }, track)));
      }

      var links = h('ul', { class: 'footer__links' });
      m.links.forEach(function (l) { links.appendChild(h('li', {}, h('a', Object.assign(H.linkAttrs(l), { html: esc(l.label) + ARROW })))); });
      root.appendChild(h('footer', { class: 'footer reveal', 'data-anchor': 'footer' }, h('h2', { class: 'section-title', text: m.footerTitle }), links));
      root.appendChild(h('div', { 'data-chrome': '' }, H.switcher()));
      return root;
    },

    // the hero fading out, blocks easing in, and the endless ticker
    mount: function (host) {
      var sr = host.shadowRoot, stops = [];
      var hero = sr.querySelector('.hero');
      if (hero) {
        var ticking = false;
        var update = function () {
          var o = Math.max(0, 1 - window.scrollY / (window.innerHeight * 0.55));
          hero.style.opacity = o.toFixed(3); hero.style.visibility = o === 0 ? 'hidden' : ''; ticking = false;
        };
        var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
        window.addEventListener('scroll', onScroll, { passive: true });
        stops.push(function () { window.removeEventListener('scroll', onScroll); });
        update();
      }
      var items = sr.querySelectorAll('.reveal');
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
        }, { rootMargin: '0px 0px -8% 0px' });
        items.forEach(function (el) { io.observe(el); });
        stops.push(function () { io.disconnect(); });
      } else items.forEach(function (el) { el.classList.add('is-in'); });
      var ticker = sr.querySelector('.ticker');
      if (ticker && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        var track = ticker.querySelector('.ticker__track');
        Array.prototype.slice.call(track.children).forEach(function (li) {
          var copy = li.cloneNode(true);
          copy.setAttribute('aria-hidden', 'true'); copy.removeAttribute('data-anchor');
          copy.querySelectorAll('a').forEach(function (a) { a.tabIndex = -1; });
          track.appendChild(copy);
        });
        ticker.classList.add('is-running');
      }
      host._stop = function () { stops.forEach(function (f) { f(); }); };
    },
    unmount: function (host) { if (host._stop) host._stop(); }
  });
})();
