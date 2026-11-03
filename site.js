(function () {
  // Fade the hero out as the work scrolls over it.
  var hero = document.querySelector('.hero');
  if (hero) {
    var ticking = false;
    var update = function () {
      var o = Math.max(0, 1 - window.scrollY / (window.innerHeight * 0.55));
      hero.style.opacity = o.toFixed(3);
      hero.style.visibility = o === 0 ? 'hidden' : '';
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // Reveal blocks as they enter the viewport.
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('is-in'); });
  }

  // Endless ticker: duplicate the highlights once so the loop is seamless.
  var ticker = document.querySelector('.ticker');
  if (ticker && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var track = ticker.querySelector('.ticker__track');
    Array.prototype.slice.call(track.children).forEach(function (li) {
      var copy = li.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      copy.querySelectorAll('a').forEach(function (a) { a.tabIndex = -1; });
      track.appendChild(copy);
    });
    ticker.classList.add('is-running');
  }

  // Scramble the intro text around the mouse pointer.
  // Each letter keeps its own space (made invisible) and the random letter is
  // drawn on top, so the text never reflows while it scrambles.
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (hero && canHover && !calm) {
    var RADIUS = 60;          // px around the pointer that scramble
    var TICK = 55;            // ms between random letters
    // Random letters come from a group of similar width, so they fit the real letter's space.
    var GROUPS = ['fijlrt', 'abcdeghknopqsuvxyz', 'mw', 'IJ', 'ABCDEFGHKLNOPQRSTUVXYZ', 'MW', '0123456789'];
    var groupOf = {};
    GROUPS.forEach(function (g) { g.split('').forEach(function (ch) { groupOf[ch] = g; }); });
    var chars = [];

    var randomFor = function (ch) {
      var g = groupOf[ch];
      return g ? g.charAt(Math.floor(Math.random() * g.length)) : null; // leave punctuation alone
    };

    // Wrap every scrambleable character in a span (spaces stay as text so lines wrap as before).
    hero.querySelectorAll('.hero__name, .hero__tagline p, .hero__bio p').forEach(function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (node) {
        var frag = document.createDocumentFragment();
        var plain = '';
        Array.from(node.data).forEach(function (ch) {
          if (!randomFor(ch)) { plain += ch; return; }
          if (plain) { frag.appendChild(document.createTextNode(plain)); plain = ''; }
          var span = document.createElement('span');
          span.className = 'ch';
          span.textContent = ch;
          frag.appendChild(span);
          chars.push({ el: span, ch: ch, x: 0, y: 0, until: 0, next: 0 });
        });
        if (plain) frag.appendChild(document.createTextNode(plain));
        node.parentNode.replaceChild(frag, node);
      });
    });

    var dirty = true;
    var measure = function () {
      chars.forEach(function (c) {
        var r = c.el.getBoundingClientRect();
        c.x = r.left + r.width / 2;
        c.y = r.top + r.height / 2;
      });
      dirty = false;
    };
    window.addEventListener('resize', function () { dirty = true; });
    window.addEventListener('scroll', function () { dirty = true; }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { dirty = true; });

    var running = false;
    var frame = function (now) {
      var active = false;
      chars.forEach(function (c) {
        if (c.until > now) {
          active = true;
          if (now >= c.next) {
            c.el.setAttribute('data-s', randomFor(c.ch));
            c.el.classList.add('is-scrambling');
            c.next = now + TICK;
          }
        } else if (c.next) {
          c.el.classList.remove('is-scrambling');
          c.next = 0;
        }
      });
      running = active;
      if (active) requestAnimationFrame(frame);
    };

    // The hero ignores pointer events (the work scrolls over it), so listen on the window.
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || parseFloat(hero.style.opacity || '1') < 0.3) return;
      if (dirty) measure();
      var now = performance.now();
      var hit = false;
      chars.forEach(function (c) {
        var dx = c.x - e.clientX, dy = c.y - e.clientY;
        if (dx * dx + dy * dy < RADIUS * RADIUS && c.until < now + 150) {
          // Letters closer to the pointer scramble a little longer.
          var closeness = 1 - Math.sqrt(dx * dx + dy * dy) / RADIUS;
          c.until = now + 250 + closeness * 350 + Math.random() * 150;
          hit = true;
        }
      });
      if (hit && !running) { running = true; requestAnimationFrame(frame); }
    }, { passive: true });
  }
})();
