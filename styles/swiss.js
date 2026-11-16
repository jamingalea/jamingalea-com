/* Style: "swiss" - minimal, grid-based, Dieter Rams. */
(function () {
  var S = window.SiteStyles = window.SiteStyles || {}; S.q = S.q || [];
  S.q.push({
    id: 'swiss', label: 'Swiss', css: '/styles/swiss.css', bg: '#ededea',
    fonts: ['400 16px "JG Sans"', '600 16px "JG Sans"'],
    render: function (m, H) {
      var h = H.h, root = h('div', { class: 'sw' });
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var tags = function (list) { return list.length ? h('ul', { class: 'tags' }, list.map(function (t) { return h('li', { class: t.highlight ? 'hl' : null, text: t.label }); })) : null; };

      root.appendChild(h('header', { class: 'top', 'data-chrome': '' },
        h('span', { class: 'dot' }), h('span', { class: 'brand', text: m.name }), H.switcher()));

      var page = h('main', { class: 'page' });
      root.appendChild(page);

      var intro = h('section', { class: 'intro grid', 'data-anchor': 'intro' });
      var big = h('div', { class: 'lead' }, h('h1', { text: m.name }));
      m.tagline.forEach(function (p) { big.appendChild(h('p', { class: 'tagline', html: p.html })); });
      var bio = h('div', { class: 'bio' }); H.paras(m.bio).forEach(function (e) { bio.appendChild(e); });
      intro.appendChild(big); intro.appendChild(bio);
      page.appendChild(intro);

      page.appendChild(h('div', { class: 'rule grid' }, h('h2', { text: m.workTitle })));
      m.projects.forEach(function (p, i) {
        var s = h('article', { class: 'project grid ' + p.column, 'data-anchor': p.id });
        var meta = h('div', { class: 'meta' },
          h('span', { class: 'num', text: pad(i + 1) }),
          h('h3', {}, h('a', H.linkAttrs(p), p.title)));
        H.paras(p.text).forEach(function (e) { meta.appendChild(e); });
        var t = tags(p.tags); if (t) meta.appendChild(t);
        s.appendChild(meta);
        if (p.image) s.appendChild(h('div', { class: 'pic' }, H.img(p.image)));
        page.appendChild(s);
      });

      if (m.highlights.length) {
        var hs = h('section', { class: 'hls', 'data-anchor': 'highlights' },
          h('div', { class: 'rule grid' }, h('h2', { text: m.highlightsTitle })));
        var list = h('div', { class: 'grid cols' });
        m.highlights.forEach(function (x) {
          var c = h('div', { class: 'hl-item', 'data-anchor': x.id },
            h('h3', {}, h('a', H.linkAttrs(x), x.title)));
          H.paras(x.text).forEach(function (e) { c.appendChild(e); });
          var t = tags(x.tags); if (t) c.appendChild(t);
          list.appendChild(c);
        });
        hs.appendChild(list); page.appendChild(hs);
      }

      var f = h('footer', { class: 'foot', 'data-anchor': 'footer' },
        h('div', { class: 'rule grid' }, h('h2', { text: m.footerTitle })));
      var fl = h('ul', { class: 'links' });
      m.links.forEach(function (l) { fl.appendChild(h('li', {}, h('a', H.linkAttrs(l), l.label))); });
      f.appendChild(fl);
      f.appendChild(h('p', { class: 'motto', text: 'Weniger, aber besser.' }));
      page.appendChild(f);
      return root;
    }
  });
})();
