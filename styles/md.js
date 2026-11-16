/* Style: "md" - the page drawn as a markdown file in an editor. */
(function () {
  var S = window.SiteStyles = window.SiteStyles || {}; S.q = S.q || [];

  // Images become ASCII: one character per cell, every image cropped to the same shape.
  var RATIO = 1896 / 1456, CELL = 0.6;   // picture shape; width of a mono character in em
  var RAMP = ' .·:-=+*#%@';
  var cache = {};
  var cols = function () { return window.innerWidth < 600 ? 80 : 150; };
  var rowsFor = function (c) { return Math.round(c * CELL / RATIO); };

  function toAscii(image, c) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var r = rowsFor(c), k = 4, W = c * k, H = r * k;
          var want = (c * CELL) / r, iw = img.naturalWidth, ih = img.naturalHeight, sw = iw, sh = ih;
          if (iw / ih > want) sw = ih * want; else sh = iw / want;
          var fx = 0.5, fy = 0.5, m = /([\d.]+)%\s+([\d.]+)%/.exec(image.focus || '');
          if (m) { fx = +m[1] / 100; fy = +m[2] / 100; }
          var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          var g = cv.getContext('2d', { willReadFrequently: true });
          g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, (iw - sw) * fx, (ih - sh) * fy, sw, sh, 0, 0, W, H);
          var px = g.getImageData(0, 0, W, H).data, cells = new Array(c * r), x, y, i, j;
          for (y = 0; y < r; y++) for (x = 0; x < c; x++) {
            var sum = 0;
            for (j = 0; j < k; j++) for (i = 0; i < k; i++) {
              var p = ((y * k + j) * W + x * k + i) * 4;
              sum += 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];
            }
            cells[y * c + x] = sum / (k * k) / 255;
          }
          // stretch the contrast so every image uses the whole ramp
          var sorted = cells.slice().sort(function (a, b) { return a - b; });
          var lo = sorted[Math.floor(sorted.length * 0.03)], hi = sorted[Math.floor(sorted.length * 0.985)];
          var span = Math.max(0.05, hi - lo), out = [];
          for (y = 0; y < r; y++) {
            var line = '';
            for (x = 0; x < c; x++) {
              var v = Math.min(1, Math.max(0, (cells[y * c + x] - lo) / span));
              line += RAMP.charAt(Math.round(Math.pow(v, 2.1) * (RAMP.length - 1)));
            }
            out.push(line.replace(/\s+$/, ''));
          }
          resolve(out.join('\n'));
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = image.src;
    });
  }

  function ascii(image) {
    var key = image.src + '|' + cols();
    return cache[key] || (cache[key] = toAscii(image, cols()).then(function (t) { cache[key] = { text: t }; return cache[key]; }));
  }
  S.q.push({
    id: 'md', label: 'README.md', css: '/styles/md.css', bg: '#0d1117',
    fonts: ['400 16px "JG Mono"', '700 16px "JG Mono"'],
    preload: function (m) {
      return Promise.all(m.projects.filter(function (p) { return p.image; }).map(function (p) { return ascii(p.image).catch(function () {}); }));
    },
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
        if (p.image) {
          var done = cache[p.image.src + '|' + cols()], art;
          if (done && done.text) art = h('pre', { class: 'ascii', role: 'img', 'aria-label': p.image.alt || p.title, text: done.text, style: '--w:' + (cols() * CELL) });
          else art = H.img(p.image, 'plain');   // not ready in time: show the real image instead
          s.appendChild(h('figure', {}, art, h('figcaption', { text: '![' + (p.image.alt || p.title) + '](' + p.image.src.split('/').pop() + ')' })));
        }
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
