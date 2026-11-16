/* Style: "md" - the page drawn as a markdown file in an editor. */
(function () {
  var S = window.SiteStyles = window.SiteStyles || {}; S.q = S.q || [];
  S.q.push({
    id: 'md', label: 'README.md', css: '/styles/md.css', bg: '#0d1117',
    fonts: ['400 16px "JG Mono"', '700 16px "JG Mono"'],
    render: function (m, H) {
      var h = H.h, root = h('div', { class: 'md' });
      var tag = function (t) { return h('span', { class: 'tag' + (t.highlight ? ' hl' : ''), text: t.label }); };
      var tags = function (list) { return list.length ? h('p', { class: 'tags' }, list.map(tag)) : null; };
      var line = function (n) { return h('span', { class: 'mark', text: n }); };

      var bar = h('div', { class: 'bar', 'data-chrome': '' },
        h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
        h('span', { class: 'file', text: 'README.md' }),
        H.switcher());
      root.appendChild(bar);

      var doc = h('main', { class: 'doc' });
      root.appendChild(doc);

      var intro = h('section', { 'data-anchor': 'intro' },
        h('h1', {}, line('# '), m.name));
      m.tagline.forEach(function (p) { intro.appendChild(h('blockquote', {}, line('> '), h('span', { html: p.html }))); });
      m.bio.forEach(function (p) { intro.appendChild(h('p', { html: p.html })); });
      doc.appendChild(intro);

      doc.appendChild(h('h2', {}, line('## '), m.workTitle));
      m.projects.forEach(function (p) {
        var s = h('section', { class: 'project', 'data-anchor': p.id });
        s.appendChild(h('h3', {}, line('### '), h('a', H.linkAttrs(p), p.title)));
        if (p.image) s.appendChild(h('figure', {}, H.img(p.image), h('figcaption', { text: '![' + (p.image.alt || p.title) + ']' })));
        H.paras(p.text).forEach(function (e) { s.appendChild(e); });
        var t = tags(p.tags); if (t) s.appendChild(t);
        doc.appendChild(s);
      });

      if (m.highlights.length) {
        var hs = h('section', { 'data-anchor': 'highlights' }, h('h2', {}, line('## '), m.highlightsTitle));
        var ul = h('ul');
        m.highlights.forEach(function (x) {
          var li = h('li', { 'data-anchor': x.id }, h('a', H.linkAttrs(x), x.title));
          x.text.forEach(function (p) { li.appendChild(h('div', { class: 'sub', html: p.html })); });
          var t = tags(x.tags); if (t) li.appendChild(t);
          ul.appendChild(li);
        });
        hs.appendChild(ul); doc.appendChild(hs);
      }

      var f = h('footer', { 'data-anchor': 'footer' }, h('hr'), h('h2', {}, line('## '), m.footerTitle));
      var fl = h('ul');
      m.links.forEach(function (l) { fl.appendChild(h('li', {}, h('a', H.linkAttrs(l), l.label))); });
      f.appendChild(fl);
      doc.appendChild(f);
      return root;
    }
  });
})();
