/* Style: "showcase" - a product-launch page: big centred type, rounded tiles, lots of air. */
(function () {
  var S = window.SiteStyles = window.SiteStyles || {}; S.q = S.q || [];
  S.q.push({
    id: 'showcase', label: 'Showcase', css: '/styles/showcase.css', bg: '#ffffff', enter: 'rise', accent: '#0071e3',
    fonts: ['400 17px "JG Sans"', '600 17px "JG Sans"'],
    render: function (m, H) {
      var h = H.h, root = h('div', { class: 'ap' });
      var paras = function (cls, list) { var d = h('div', { class: cls }); H.paras(list).forEach(function (e) { d.appendChild(e); }); return d; };
      var meta = function (tags) {
        return tags.length ? h('p', { class: 'meta' }, tags.map(function (t, i) {
          return [i ? ' · ' : '', t.highlight ? h('span', { class: 'hl', text: t.label }) : t.label];
        })) : null;
      };

      root.appendChild(h('nav', { class: 'nav', 'data-chrome': '' }, h('span', { class: 'brand', text: m.name }), H.switcher()));

      var hero = h('header', { class: 'hero', 'data-anchor': 'intro' },
        h('h1', { 'data-rise': '', text: m.name }));
      var tag = paras('tagline', m.tagline); tag.setAttribute('data-rise', ''); hero.appendChild(tag);
      var bio = paras('bio', m.bio); bio.setAttribute('data-rise', ''); hero.appendChild(bio);
      root.appendChild(hero);

      var tiles = h('main', { class: 'tiles', 'aria-label': m.workTitle });
      m.projects.forEach(function (p) {
        var hl = p.tags.filter(function (t) { return t.highlight; })[0];
        var t = h('article', { class: 'tile' + (p.column === 'right' ? ' half' : ''), 'data-anchor': p.id, 'data-rise': '' });
        if (hl) t.appendChild(h('p', { class: 'eyebrow', text: hl.label }));
        t.appendChild(h('h3', { text: p.title }));
        t.appendChild(paras('text', p.text));
        if (p.href) {
          var cta = h('p', { class: 'cta' });
          if (p.caseStudy) cta.appendChild(h('a', Object.assign(H.linkAttrs(p), { class: 'pill', text: 'Read the case study' })));
          else cta.appendChild(h('a', Object.assign(H.linkAttrs(p), { text: 'Visit the site ›' })));
          t.appendChild(cta);
        }
        var mt = meta(p.tags.filter(function (x) { return x !== hl; })); if (mt) t.appendChild(mt);
        if (p.image) t.appendChild(h('div', { class: 'pic' }, H.img(p.image)));
        tiles.appendChild(t);
      });
      root.appendChild(tiles);

      if (m.highlights.length) {
        var rail = h('div', { class: 'rail' });
        m.highlights.forEach(function (x) {
          var card = h('div', { class: 'card', 'data-anchor': x.id, 'data-rise': '' });
          if (x.icon) card.appendChild(h('img', { class: 'icon', src: x.icon, alt: '', loading: 'lazy' }));
          card.appendChild(h('h3', {}, x.href ? h('a', H.linkAttrs(x), x.title) : x.title));
          card.appendChild(paras('text', x.text));
          var mt = meta(x.tags); if (mt) card.appendChild(mt);
          rail.appendChild(card);
        });
        root.appendChild(h('section', { class: 'highlights', 'data-anchor': 'highlights' },
          h('h2', { 'data-rise': '', text: m.highlightsTitle }), rail));
      }

      var links = h('p', { class: 'links' });
      m.links.forEach(function (l, i) { if (i) links.appendChild(h('span', { class: 'sep', text: '|' })); links.appendChild(h('a', H.linkAttrs(l), l.label)); });
      root.appendChild(h('footer', { class: 'foot', 'data-anchor': 'footer', 'data-rise': '' },
        h('h2', { text: m.footerTitle }), links, h('p', { class: 'small', text: 'Designed in London.' })));
      return root;
    }
  });
})();
