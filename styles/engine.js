/* Page styles
 * ------------------------------------------------------------------
 * Draws the homepage in one of several styles. Each visit gets a style
 * (never the same one twice running, per browser). After the visitor has
 * lingered for a while the page glitches into another style, keeping them
 * on the same project.
 *
 * The content comes from <script id="site-model"> (built by render.mjs from
 * content.json). A style is a small file that turns that model into DOM:
 * see styles/md.js and styles/swiss.js, and the README ("Page styles").
 *
 * Testing:  ?style=md | swiss | classic   show one style, no auto switching
 *           ?style=off                    the plain server-rendered page, no engine
 *           ?linger=10                    switch after 10 s instead of 60
 *           ?linger=off                   never switch by itself
 *           ?fx=glitch | typing | grid | skeleton | rise | fade   use one entrance for every switch (default: each style's own)
 */
(function () {
  'use strict';

  var CONFIG = {
    lingerSeconds: 60,      // time on the page (tab visible) before the page switches style
    repeat: true,           // keep switching every lingerSeconds; false = once per visit
    glitchMs: 950,          // length of the glitch
    readLine: 0.4,          // how far down the screen "where you are" is (0 = top, 1 = bottom)
    storageKey: 'jg-style', // remembers the last style, so the next visit gets a different one
    pendingClass: 'style-pending'
  };

  var root = document.documentElement;
  var reveal = function () { root.classList.remove(CONFIG.pendingClass); };

  /* ---------- can we run? ---------- */
  var supported = !!(Element.prototype.attachShadow && window.CSSStyleSheet &&
    CSSStyleSheet.prototype.replaceSync && 'adoptedStyleSheets' in Document.prototype);
  var params = new URLSearchParams(location.search);
  var forced = params.get('style');
  if (!supported || forced === 'off') { reveal(); return; }

  var model = null;
  try { model = JSON.parse(document.getElementById('site-model').textContent); } catch (e) { /* no model */ }
  if (!model) { reveal(); return; }

  /* ---------- style registry ---------- */
  var themes = {}, order = [];
  function register(t) {
    if (!t || !t.id || themes[t.id]) return;
    themes[t.id] = t; order.push(t.id);
  }
  var S = window.SiteStyles = window.SiteStyles || {};
  (S.q || []).forEach(register);
  S.q = [];
  S.register = register;

  function rotation() { return order.filter(function (id) { return themes[id].rotate !== false; }); }
  if (!order.length) { reveal(); return; }

  /* ---------- small helpers ---------- */
  var store = {
    get: function () { try { return localStorage.getItem(CONFIG.storageKey) || ''; } catch (e) { return ''; } },
    set: function (v) { try { localStorage.setItem(CONFIG.storageKey, v); } catch (e) { /* private mode */ } }
  };
  var reduceMotion = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };

  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }

  var sheets = {};
  function loadSheet(url) {
    if (!sheets[url]) {
      sheets[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url);
        return r.text();
      }).then(function (css) { var s = new CSSStyleSheet(); s.replaceSync(css); return s; });
    }
    return sheets[url];
  }

  function fontsReady(t) {
    if (!document.fonts || !t.fonts) return Promise.resolve();
    var all = Promise.all(t.fonts.map(function (f) { return document.fonts.load(f); }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 1200); })]);
  }

  /* What every style gets to build its page with. */
  function helpers(id) {
    return {
      h: h,
      // <p> elements from a list of model paragraphs
      paras: function (list) { return (list || []).map(function (p) { return h('p', { html: p.html }); }); },
      // attributes for a link to a model item (project, highlight, footer link)
      linkAttrs: function (item) {
        return { href: item.href, target: item.external ? '_blank' : null, rel: item.external ? 'noopener' : null };
      },
      // <img> for a model image, cropped around its focus point
      img: function (image, cls) {
        return h('img', {
          class: cls, src: image.src, alt: image.alt, loading: 'lazy', decoding: 'async',
          style: image.focus ? 'object-position:' + image.focus : null
        });
      },
      // the "switch style" control; styles place it wherever it fits
      switcher: function () {
        var wrap = h('span', { class: 'style-switch', role: 'group', 'aria-label': 'Page style' });
        rotation().forEach(function (t) {
          wrap.appendChild(h('button', {
            type: 'button', 'data-style-go': t, 'aria-pressed': t === id ? 'true' : 'false',
            text: themes[t].label || t
          }));
        });
        return wrap;
      }
    };
  }

  /* ---------- building and showing a style ---------- */
  var current = '', currentHost = null, busy = false;

  var base = h('style', { text:
    '.site-stage{display:block;min-height:100vh}' +
    'html.styled body>header,html.styled body>main,html.styled body>footer{display:none!important}' +
    'html.styled body{background:transparent!important}' });
  document.head.appendChild(base);
  document.head.appendChild(h('link', { rel: 'stylesheet', href: '/styles/fonts.css' }));

  function build(id) {
    var t = themes[id];
    var pre = t.preload ? Promise.race([t.preload(model).catch(function () {}), new Promise(function (r) { setTimeout(r, 2500); })]) : null;
    return Promise.all([loadSheet(t.css), fontsReady(t), pre]).then(function (r) {
      var host = h('div', { class: 'site-stage', 'data-theme': id });
      var sr = host.attachShadow({ mode: 'open' });
      sr.adoptedStyleSheets = [r[0]];
      sr.appendChild(t.render(model, helpers(id)));
      host.addEventListener('click', onClick);
      return host;
    });
  }

  function chrome(id) {
    var t = themes[id];
    if (t.bg) root.style.backgroundColor = t.bg;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = h('meta', { name: 'theme-color' }); document.head.appendChild(meta); }
    if (t.bg) meta.setAttribute('content', t.bg);
    root.setAttribute('data-style', id);
  }

  function attach(host, id) {
    if (currentHost) {
      var o = themes[current];
      if (o.unmount) o.unmount(currentHost);
      currentHost.remove();
    }
    document.body.insertBefore(host, document.body.firstChild);
    root.classList.add('styled');
    chrome(id);
    current = id; currentHost = host;
    store.set(id);
    if (themes[id].mount) themes[id].mount(host, { scroll: scrollToAnchor });
  }

  function onClick(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (el && el.getAttribute && el.hasAttribute('data-style-go')) {
        e.preventDefault();
        go(el.getAttribute('data-style-go'));
        return;
      }
    }
  }

  /* ---------- keeping your place ---------- */
  // Every style marks its blocks with data-anchor="<id>" (the project ids, "intro",
  // "highlights", "highlight-N", "footer"). Before a switch we note which block sits
  // on the reading line and how far through it we are; afterwards we put that same
  // spot on the reading line again.
  function docHeight() { return Math.max(root.scrollHeight, document.body.scrollHeight); }

  function capture() {
    var vh = window.innerHeight, y = window.scrollY, ref = vh * CONFIG.readLine;
    if (y <= 2) return { mode: 'top' };
    if (y + vh >= docHeight() - 2) return { mode: 'bottom' };
    var best = null, bestTop = -Infinity;
    currentHost.shadowRoot.querySelectorAll('[data-anchor]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.height > 0 && r.top <= ref && r.top > bestTop) { best = el; bestTop = r.top; }
    });
    if (!best) return { mode: 'ratio', f: y / Math.max(1, docHeight() - vh) };
    var rb = best.getBoundingClientRect();
    return { mode: 'anchor', id: best.getAttribute('data-anchor'), f: Math.min(1, Math.max(0, (ref - rb.top) / rb.height)) };
  }

  function restore(snap, host) {
    var vh = window.innerHeight, max = Math.max(0, docHeight() - vh), y = 0;
    if (snap.mode === 'bottom') y = max;
    else if (snap.mode === 'ratio') y = snap.f * max;
    else if (snap.mode === 'anchor') {
      var el = host.shadowRoot.querySelector('[data-anchor="' + snap.id + '"],[data-anchor-passive="' + snap.id + '"]');
      if (el) {
        var r = el.getBoundingClientRect();
        y = r.top + window.scrollY + snap.f * r.height - vh * CONFIG.readLine;
      }
    }
    window.scrollTo({ left: 0, top: Math.min(max, Math.max(0, Math.round(y))), behavior: 'instant' });
  }

  function scrollToAnchor(id, smooth) {
    var el = currentHost && currentHost.shadowRoot.querySelector('[data-anchor="' + id + '"],[data-anchor-passive="' + id + '"]');
    if (!el) return false;
    var top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ left: 0, top: Math.max(0, top - 16), behavior: smooth && !reduceMotion() ? 'smooth' : 'instant' });
    return true;
  }

  /* ---------- the glitch ---------- */
  var fx = new CSSStyleSheet();
  // chromatic split on text while a band is being torn sideways
  fx.replaceSync('*{text-shadow:2px 0 rgba(255,30,90,.75),-2px 0 rgba(30,225,255,.75)!important}');

  function cloneHost(host) {
    var c = h('div', { class: 'site-stage', 'data-theme': host.getAttribute('data-theme'), 'aria-hidden': 'true' });
    var sr = c.attachShadow({ mode: 'open' });
    sr.adoptedStyleSheets = host.shadowRoot.adoptedStyleSheets;
    var frag = document.createDocumentFragment();
    Array.prototype.forEach.call(host.shadowRoot.childNodes, function (n) { frag.appendChild(n.cloneNode(true)); });
    // sticky/fixed bars don't survive being sliced into bands; they reappear when it ends
    frag.querySelectorAll('[data-chrome]').forEach(function (n) { n.remove(); });
    frag.querySelectorAll('[data-flat]').forEach(function (n) { n.style.position = 'relative'; });
    sr.appendChild(frag);
    return c;
  }

  function layer(host, width, scrollY, bandTop) {
    var d = h('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:' + width + 'px;transform:translateY(' + (-(scrollY + bandTop)) + 'px)';
    d.appendChild(cloneHost(host));
    return d;
  }

  function makeBands(vh, vw) {
    var n = vh < 560 ? 8 : 11, w = [], sum = 0, i;
    for (i = 0; i < n; i++) { var x = 0.35 + Math.random() * 1.65; w.push(x); sum += x; }
    var scale = Math.min(1, Math.max(0.3, vw / 1200)), top = 0, out = [];
    for (i = 0; i < n; i++) {
      var bh = i === n - 1 ? vh - top : Math.round(vh * w[i] / sum);
      out.push({
        top: top, h: bh,
        ts: 0.2 + Math.random() * 0.55,                               // when this band turns into the new style
        amp: Math.random() < 0.65 ? (8 + Math.random() * 56) * scale : 0  // how far it can slip sideways
      });
      top += bh;
    }
    return out;
  }

  var blockKeys = { 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 37: 1, 38: 1, 39: 1, 40: 1 };
  function stop(e) { e.preventDefault(); }
  function stopKey(e) { if (blockKeys[e.keyCode]) e.preventDefault(); }
  function lock(on) {
    var m = on ? 'addEventListener' : 'removeEventListener';
    window[m]('wheel', stop, { passive: false });
    window[m]('touchmove', stop, { passive: false });
    window[m]('keydown', stopKey);
  }

  /* ---------- entrances ----------
   * Each style says how it arrives with `enter: '<name>'`. Unknown or missing = the glitch.
   * An entrance has setup(ctx), which runs while the old page is still in the overlay, and
   * run(ctx, finish), which runs once the new page is in place underneath. Try one on any
   * style with ?fx=<name>. */
  var effects = {};

  // README: the screen fills with the new background line by line, and the text follows,
  // typed out at speed with a block cursor. Images and boxes appear as the typing reaches them.
  effects.typing = {
    run: function (c, finish) {
      var vh = c.vh, sr = c.newHost.shadowRoot, items = [], total = 0;
      var onScreen = function (el) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && r.height > 0; };

      // everything visible, in reading order: text nodes get typed, boxes and images pop in
      var walker = document.createTreeWalker(sr, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (var n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 3) {
          var p = n.parentElement;
          if (!p || !n.data.trim() || !onScreen(p) || p.closest('figure')) continue;
          var full = n.data, shown = document.createTextNode(''), rest = document.createElement('span'), wrap = document.createElement('span');
          rest.style.color = 'transparent';
          rest.textContent = full;
          wrap.appendChild(shown); wrap.appendChild(rest);
          items.push({ kind: 'text', node: n, wrap: wrap, shown: shown, rest: rest, full: full, at: total });
          total += full.length;
        } else if (n.matches('figure, img:not(figure img), .tag, hr') && onScreen(n)) {
          items.push({ kind: 'box', el: n, at: total });
          total += 40;   // a pause the length of a short line
        }
      }
      items.forEach(function (it) {
        if (it.kind === 'text') it.node.replaceWith(it.wrap);
        else it.el.style.visibility = 'hidden';
      });

      var caret = h('div'); caret.setAttribute('aria-hidden', 'true');
      caret.style.cssText = 'position:fixed;z-index:2147483001;pointer-events:none;width:9px;height:18px;left:-20px;top:0;background:' + c.accent;
      document.body.appendChild(caret);

      var row = 26, steps = Math.ceil(vh / row), fillT = 420, typeT = Math.min(1100, 300 + total * 0.5), lag = 140;
      var t0 = performance.now(), done = 0, range = document.createRange();
      var cleanUp = function () {
        items.forEach(function (it) {
          if (it.kind === 'text') it.wrap.replaceWith(it.node);
          else it.el.style.visibility = '';
        });
        caret.remove(); finish();
      };

      (function frame(now) {
        var el = now - t0;
        // the fill: the old page is cut away one line at a time from the top
        var f = Math.min(1, el / fillT);
        c.overlay.style.clipPath = 'inset(' + Math.floor(f * steps) * row + 'px 0 0 0)';
        // the typing
        var k = Math.max(0, Math.min(1, (el - lag) / typeT)), upto = Math.round(k * total), last = null;
        for (var i = done; i < items.length; i++) {
          var it = items[i];
          if (it.at > upto) break;
          if (it.kind === 'text') {
            var m = Math.min(it.full.length, upto - it.at);
            if (it.shown.data.length !== m) { it.shown.data = it.full.slice(0, m); it.rest.textContent = it.full.slice(m); }
            last = it;
            if (m === it.full.length && i === done) done++;
          } else { it.el.style.visibility = ''; if (i === done) done++; }
        }
        if (last) {
          range.setStart(last.shown, last.shown.data.length); range.collapse(true);
          var r = range.getClientRects()[0] || last.wrap.getBoundingClientRect();
          caret.style.left = Math.round(r.right + 1) + 'px';
          caret.style.top = Math.round(r.top + (r.height - 18) / 2) + 'px';
        }
        caret.style.opacity = k >= 1 ? (Math.floor(el / 120) % 2 ? '0' : '1') : '1';
        if (el < Math.max(fillT, lag + typeT) + 240) requestAnimationFrame(frame); else cleanUp();
      })(t0);
    }
  };

  // Swiss: the old page leaves as twelve columns, one after another, each trailing a thin rule
  effects.grid = {
    setup: function (c) {
      c.band.el.remove();
      c.cols = [];
      var n = 12, w = c.vw / n;
      for (var i = 0; i < n; i++) {
        var col = h('div');
        col.style.cssText = 'position:absolute;top:0;height:' + c.vh + 'px;left:' + (i * w) + 'px;width:' + (w + 1) +
          'px;overflow:hidden;box-shadow:0 2px 0 ' + c.accent;
        var inner = h('div');
        inner.style.cssText = 'position:absolute;left:' + (-i * w) + 'px;top:0;width:' + c.vw + 'px;transform:translateY(' + (-c.sy) + 'px)';
        inner.appendChild(cloneHost(c.oldHost));
        col.appendChild(inner);
        c.overlay.appendChild(col);
        c.cols.push(col);
      }
      c.overlay.style.background = 'transparent';
    },
    run: function (c, finish) {
      var n = c.cols.length, delay = 38, dur = 520;
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        c.cols.forEach(function (col, i) {
          col.style.transition = 'transform ' + dur + 'ms cubic-bezier(.76,0,.24,1) ' + (i * delay) + 'ms';
          col.style.transform = 'translateY(-' + (c.vh + 8) + 'px)';
        });
      }); });
      setTimeout(finish, (n - 1) * delay + dur + 60);
    }
  };

  // Swiss: the new layout is drawn first as a wireframe (bars for each line of text, crossed
  // boxes for images, hairlines for rules), then each box fills with its own content, top to bottom
  effects.skeleton = {
    run: function (c, finish) {
      var vw = c.vw, vh = c.vh, sr = c.newHost.shadowRoot, boxes = [], blocks = [];
      var sk = h('div'); sk.setAttribute('aria-hidden', 'true');
      sk.style.cssText = 'position:fixed;left:0;top:0;width:' + vw + 'px;height:' + vh + 'px;overflow:hidden;z-index:2147482999;pointer-events:none';
      var line = '#d0d0d0', X = function (dir) { return 'linear-gradient(to ' + dir + ',transparent calc(50% - .6px),' + line + ' 50%,transparent calc(50% + .6px))'; };
      var bar = sr.querySelector('[data-chrome]'), hb = bar ? bar.getBoundingClientRect().bottom : 0;
      var under = function (e, r) { return !(bar && bar.contains(e)) && r.top < hb; };
      var seen = function (r) { return r.bottom > 0 && r.top < vh && r.width > 1 && r.height > 0; };

      function box(r, kind, block) {
        var b = h('div'), top = r.top, ht = r.height, bg = '';
        if (kind === 'text') { ht = Math.max(5, Math.round(r.height * 0.5)); top = r.top + (r.height - ht) / 2; bg = 'background:#dcdcdc'; }
        else if (kind === 'img') bg = 'background:#e7e7e7;box-shadow:inset 0 0 0 1px ' + line + ';background-image:' + X('top right') + ',' + X('bottom right');
        else { ht = 1; bg = 'background:' + line; }
        b.style.cssText = 'position:absolute;left:' + r.left + 'px;top:' + top + 'px;width:' + r.width + 'px;height:' + ht +
          'px;transform:scaleX(0);transform-origin:left center;' + bg;
        b._t = r.top;
        sk.appendChild(b); boxes.push(b); block.boxes.push(b);
      }
      // a block is one real element plus the wireframe pieces that stand in for it
      function block(e, kind, rects) {
        rects = rects.filter(function (r) { return seen(r) && !under(e, r); });
        if (!rects.length) return;
        var bl = { el: e, top: rects[0].top, boxes: [] };
        rects.forEach(function (r) { box(r, kind, bl); });
        e.style.opacity = '0';
        blocks.push(bl);
      }
      var lines = function (e) { var rg = document.createRange(); rg.selectNodeContents(e); return Array.prototype.slice.call(rg.getClientRects()); };
      sr.querySelectorAll('img').forEach(function (e) { block(e, 'img', [e.getBoundingClientRect()]); });
      sr.querySelectorAll('h1,h2,h3,p,.brand,.num,.motto').forEach(function (e) { block(e, 'text', lines(e)); });
      sr.querySelectorAll('.tags li,.links li,.style-switch button').forEach(function (e) { block(e, 'text', [e.getBoundingClientRect()]); });
      sr.querySelectorAll('.rule').forEach(function (e) {
        var r = e.getBoundingClientRect();
        if (seen(r) && !under(e, r)) { var bl = { el: null, top: r.top, boxes: [] }; box({ left: r.left, width: r.width, top: r.top, height: 1 }, 'line', bl); blocks.push(bl); }
      });
      document.body.appendChild(sk);

      // 1. the old page fades out while the wireframe draws itself, top to bottom
      c.overlay.style.transition = 'opacity 220ms ease';
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        c.overlay.style.opacity = '0';
        boxes.forEach(function (b) {
          b.style.transition = 'transform 320ms cubic-bezier(.2,.7,.2,1) ' + Math.round(80 + Math.max(0, b._t) / vh * 300) + 'ms';
          b.style.transform = 'scaleX(1)';
        });
      }); });

      // 2. each block fills with its content, top to bottom
      var start = 760, spread = 380, fade = 280;
      setTimeout(function () {
        blocks.forEach(function (bl) {
          var d = Math.round(Math.max(0, bl.top) / vh * spread) + 'ms';
          bl.boxes.forEach(function (b) { b.style.transition = 'opacity ' + fade + 'ms ease ' + d; b.style.opacity = '0'; });
          if (bl.el) { bl.el.style.transition = 'opacity ' + fade + 'ms ease ' + d; bl.el.style.opacity = '1'; }
        });
      }, start);
      setTimeout(function () {
        blocks.forEach(function (bl) { if (bl.el) { bl.el.style.transition = ''; bl.el.style.opacity = ''; } });
        sk.remove(); finish();
      }, start + spread + fade + 60);
    }
  };

  // Showcase: the old page fades away and the new blocks (marked data-rise) float up into place
  effects.rise = {
    run: function (c, finish) {
      var vh = c.vh, sr = c.newHost.shadowRoot;
      var els = Array.prototype.filter.call(sr.querySelectorAll('[data-rise]'), function (e) {
        var r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < vh;
      });
      els.forEach(function (e) { e.style.opacity = '0'; e.style.transform = 'translateY(32px)'; });
      c.overlay.style.transition = 'opacity 320ms ease';
      requestAnimationFrame(function () { requestAnimationFrame(function () { c.overlay.style.opacity = '0'; }); });
      var last = 0;
      els.forEach(function (e, i) {
        var d = 180 + Math.min(i, 7) * 90; last = Math.max(last, d);
        e.style.transition = 'opacity 800ms cubic-bezier(.25,.1,.25,1) ' + d + 'ms, transform 1000ms cubic-bezier(.16,1,.3,1) ' + d + 'ms';
      });
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        els.forEach(function (e) { e.style.opacity = '1'; e.style.transform = 'none'; });
      }); });
      setTimeout(function () {
        els.forEach(function (e) { e.style.transition = ''; e.style.opacity = ''; e.style.transform = ''; });
        finish();
      }, last + 1050);
    }
  };

  // Classic: a slow, plain dissolve
  effects.fade = {
    run: function (c, finish) {
      c.overlay.style.transition = 'opacity 650ms ease';
      requestAnimationFrame(function () { requestAnimationFrame(function () { c.overlay.style.opacity = '0'; }); });
      setTimeout(finish, 700);
    }
  };

  function transition(oldHost, newHost, oldId, newId, snap, done) {
    var calm = reduceMotion();
    var vw = root.clientWidth, vh = window.innerHeight, sy = window.scrollY;
    var oldBg = themes[oldId].bg || '#000', newBg = themes[newId].bg || '#000';
    var oldSheets = oldHost.shadowRoot.adoptedStyleSheets, newSheets = newHost.shadowRoot.adoptedStyleSheets;

    var overlay = h('div', { class: 'site-glitch', 'aria-hidden': 'true' });
    overlay.style.cssText = 'position:fixed;left:0;top:0;width:' + vw + 'px;height:' + vh +
      'px;overflow:hidden;z-index:2147483000;pointer-events:none;background:' + oldBg;

    var fxName = params.get('fx') || themes[newId].enter || 'glitch';
    var custom = !calm && fxName !== 'glitch' ? effects[fxName] : null;
    var bands = (calm || custom) ? [{ top: 0, h: vh, ts: 0, amp: 0 }] : makeBands(vh, vw);
    bands.forEach(function (b) {
      b.el = h('div');
      b.el.style.cssText = 'position:absolute;left:0;width:' + vw + 'px;top:' + b.top + 'px;height:' + b.h + 'px;overflow:hidden';
      b.old = layer(oldHost, vw, sy, b.top);
      b.el.appendChild(b.old);
      overlay.appendChild(b.el);
    });
    var ctx = { overlay: overlay, band: bands[0], vw: vw, vh: vh, sy: sy, oldHost: oldHost, newHost: newHost,
      oldBg: oldBg, newBg: newBg, accent: themes[newId].accent || '#fff' };
    if (custom && custom.setup) custom.setup(ctx);
    document.body.appendChild(overlay);   // the old look now sits on top of everything
    lock(true);

    // swap the real page underneath and put the reader back where they were
    attach(newHost, newId);
    restore(snap, newHost);
    var ny = window.scrollY;

    var finish = function () {
      overlay.remove(); lock(false); done();
    };

    if (custom) { custom.run(ctx, finish); return; }

    if (calm) {                            // reduced motion: a plain crossfade
      overlay.style.transition = 'opacity 320ms ease';
      requestAnimationFrame(function () { requestAnimationFrame(function () { overlay.style.opacity = '0'; }); });
      setTimeout(finish, 360);
      return;
    }

    bands.forEach(function (b) {
      b.new = layer(newHost, vw, ny, b.top);
      b.new.style.visibility = 'hidden';
      b.el.appendChild(b.new);
      b.oldRoot = b.old.firstChild.shadowRoot;
      b.newRoot = b.new.firstChild.shadowRoot;
    });

    var scan = h('div');
    scan.style.cssText = 'position:absolute;inset:0;opacity:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.09) 0,rgba(0,0,0,.09) 1px,transparent 1px,transparent 3px)';
    overlay.appendChild(scan);
    var tears = [];
    for (var k = 0; k < 4; k++) { var tr = h('div'); tr.style.cssText = 'position:absolute;height:3px;opacity:0'; overlay.appendChild(tr); tears.push(tr); }

    var t0 = performance.now(), lastStep = -1, T = CONFIG.glitchMs;
    function update(t) {
      var env = Math.sin(Math.PI * t);                // 0 → 1 → 0
      bands.forEach(function (b) {
        var isNew = t >= b.ts;
        b.old.style.visibility = isNew ? 'hidden' : 'visible';
        b.new.style.visibility = isNew ? 'visible' : 'hidden';
        var live = b.amp > 0 && env > 0.06 && Math.random() < 0.8;
        var dx = live ? (Math.random() * 2 - 1) * b.amp * env : 0;
        b.el.style.transform = dx ? 'translateX(' + dx.toFixed(1) + 'px)' : '';
        var split = Math.abs(dx) > 5;
        b.oldRoot.adoptedStyleSheets = split ? oldSheets.concat(fx) : oldSheets;
        b.newRoot.adoptedStyleSheets = split ? newSheets.concat(fx) : newSheets;
      });
      overlay.style.background = t < 0.5 ? oldBg : newBg;
      scan.style.opacity = (env * 0.9).toFixed(2);
      tears.forEach(function (tr, i) {
        var on = env > 0.15 && Math.random() < 0.55;
        tr.style.opacity = on ? '.5' : '0';
        if (on) {
          tr.style.top = Math.round(Math.random() * vh) + 'px';
          tr.style.left = Math.round(Math.random() * vw * 0.6) + 'px';
          tr.style.width = Math.round(vw * (0.15 + Math.random() * 0.5)) + 'px';
          tr.style.height = (2 + Math.round(Math.random() * 4)) + 'px';
          tr.style.background = i % 2 ? 'rgb(255,30,110)' : 'rgb(30,225,255)';
        }
      });
    }
    function frame(now) {
      var t = Math.min(1, (now - t0) / T), step = Math.floor((now - t0) / 55);
      if (step !== lastStep) { lastStep = step; update(t); }
      if (t < 1) requestAnimationFrame(frame); else finish();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- switching ---------- */
  function go(id) {
    if (busy || !themes[id] || id === current) return;
    busy = true;
    var snap = capture(), oldHost = currentHost, oldId = current;
    build(id).then(function (host) {
      transition(oldHost, host, oldId, id, snap, function () {
        busy = false; waited = 0;
        document.dispatchEvent(new CustomEvent('sitestylechange', { detail: { style: id } }));
      });
    }).catch(function () { busy = false; });
  }

  function next() {
    var pool = rotation().filter(function (id) { return id !== current; });
    if (pool.length) go(pool[Math.floor(Math.random() * pool.length)]);
  }

  /* ---------- the linger timer (counts only while the tab is visible) ---------- */
  var lingerParam = params.get('linger');
  var lingerMs = lingerParam === 'off' ? 0 : (lingerParam && +lingerParam > 0 ? +lingerParam * 1000 : (forced ? 0 : CONFIG.lingerSeconds * 1000));
  var waited = 0, lastTick = performance.now(), switches = 0;
  function tick() {
    var now = performance.now(), dt = Math.min(now - lastTick, 1500);
    lastTick = now;
    if (!lingerMs || busy || document.hidden || rotation().length < 2) return;
    waited += dt;
    if (waited >= lingerMs && (CONFIG.repeat || switches === 0)) { waited = 0; switches++; next(); }
  }
  document.addEventListener('visibilitychange', function () { lastTick = performance.now(); });

  /* ---------- start ---------- */
  function pickInitial() {
    if (forced && themes[forced]) return forced;
    var last = store.get(), pool = rotation().filter(function (id) { return id !== last; });
    if (!pool.length) pool = rotation();
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function start() {
    var id = pickInitial();
    build(id).then(function (host) {
      attach(host, id);
      reveal();
      if (location.hash.length > 1) {
        var target = decodeURIComponent(location.hash.slice(1));
        requestAnimationFrame(function () { scrollToAnchor(target, false); });
      }
      setInterval(tick, 500);
    }).catch(function () {
      root.classList.remove('styled');     // anything goes wrong: the plain page
      reveal();
    });
  }

  // read by tests and by anyone curious in the console
  S.current = function () { return current; };
  S.go = go;
  S.next = next;
  S.styles = function () { return rotation(); };
  S.config = CONFIG;
  S.effects = effects;
  S.busy = function () { return busy; };

  start();
})();
