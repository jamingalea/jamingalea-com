(function () {
  var root = document.documentElement;
  var sequencing = function () { return root.classList.contains('intro-seq'); };

  // Wide screens (intro and About side by side): the intro's home is the vertical
  // centre of the first screen, worked out from its real height.
  var intro = document.querySelector('.hero__intro');
  var hero = document.querySelector('.hero');
  var sideBySide = window.matchMedia('(min-width: 1200px)');
  var centreIntro = function () {
    if (!intro || !hero) return;
    hero.style.paddingTop = sideBySide.matches
      ? Math.max(0, Math.round(window.innerHeight / 2 - intro.offsetHeight / 2)) + 'px'
      : '';
  };
  centreIntro();
  window.addEventListener('resize', centreIntro);
  if (document.fonts) document.fonts.ready.then(centreIntro);

  // Homepage load sequence (switched on by a script in <head>): the intro fades in
  // centred on screen and pauses; then the About text and the projects load in the
  // same way, one after another. Where the intro stacks above the About text
  // (tablets, phones) it starts in the middle of the screen and glides up, with the
  // About text and projects following it. Scrolling, a key or a tap skips to the end.
  if (intro && sequencing()) {
    var FADE_IN = 900, HOLD = 1000, SETTLE = 2000, timers = [], finished = false;
    var skipEvents = ['scroll', 'wheel', 'touchstart', 'keydown', 'mousedown'];
    var cleanUp = function () {
      root.classList.remove('intro-seq', 'intro-in', 'intro-done');
      root.style.removeProperty('--intro-shift');
      window.dispatchEvent(new Event('resize')); // let the scroll fade measure the final layout
    };
    var finish = function () {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      skipEvents.forEach(function (t) { window.removeEventListener(t, finish, true); });
      root.classList.add('intro-in', 'intro-done');
      setTimeout(cleanUp, SETTLE);
    };
    var begin = function () {
      if (finished) return;
      if (window.scrollY > 40) { finish(); return; } // arrived part-way down the page
      // Side by side, the intro is already centred (no glide). Stacked, start it in
      // the middle of the screen; the About text and projects start the same distance down.
      centreIntro();
      var shift = 0;
      if (!sideBySide.matches) {
        var r = intro.getBoundingClientRect();
        var offset = new DOMMatrixReadOnly(getComputedStyle(intro).transform).m42;
        shift = Math.max(0, Math.round(window.innerHeight / 2 - (r.top - offset + r.height / 2)));
      }
      root.style.setProperty('--intro-shift', shift + 'px');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          root.classList.add('intro-in');
          timers.push(setTimeout(finish, FADE_IN + HOLD));
        });
      });
    };
    skipEvents.forEach(function (t) { window.addEventListener(t, finish, { capture: true, passive: true }); });
    // Wait briefly for the web font so the intro is measured at its real size.
    var fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 500); })]).then(begin);
  }

  // The intro text fades out as it scrolls up the screen, linked to the scroll.
  // Each piece (name, introduction, each About paragraph) fades by its own
  // position, so text further down stays readable until it gets there too.
  // A piece starts fading from where it sits on load (or 30% down the screen,
  // if lower) and is fully faded once it's half off the top.
  var fadeEls = Array.prototype.slice.call(document.querySelectorAll('.hero__name, .hero__tagline p, .hero__bio p'));
  if (fadeEls.length) {
    var fadeFrom = [], fTick = false;
    var fade = function () {
      fTick = false;
      if (sequencing()) return; // the load sequence is still placing the intro
      fadeEls.forEach(function (el, i) {
        var r = el.getBoundingClientRect();
        var end = -r.height / 2;
        var o = (r.top - end) / Math.max(fadeFrom[i] - end, 1);
        o = o >= 1 ? 1 : o <= 0 ? 0 : o;
        el.style.opacity = o === 1 ? '' : o.toFixed(3);
      });
    };
    var measureFade = function () {
      if (sequencing()) return; // measured again once the load sequence ends
      var vh = window.innerHeight;
      fadeEls.forEach(function (el, i) {
        var docTop = el.getBoundingClientRect().top + window.scrollY;
        fadeFrom[i] = Math.min(docTop, vh * 0.3);
      });
      fade();
    };
    window.addEventListener('scroll', function () { if (!fTick) { fTick = true; requestAnimationFrame(fade); } }, { passive: true });
    window.addEventListener('resize', measureFade);
    if (document.fonts) document.fonts.ready.then(measureFade);
    measureFade();
  }

  // The right-hand column scrolls up a little faster than the page (wide screens
  // only, where the columns sit side by side). The extra movement is limited to
  // the time the projects are on screen.
  var work = document.querySelector('.work');
  var rightCol = document.querySelector('.work__col--right');
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (work && rightCol && !still) {
    var SPEED = 0.2, wide = window.matchMedia('(min-width: 1200px)'), pTick = false;
    var lift = function () {
      pTick = false;
      if (!wide.matches) { rightCol.style.transform = ''; return; }
      var r = work.getBoundingClientRect(), vh = window.innerHeight;
      var travelled = Math.min(Math.max(vh - r.top, 0), r.height + vh); // 0 → section enters, max → leaves
      rightCol.style.transform = 'translate3d(0,' + (-travelled * SPEED).toFixed(1) + 'px,0)';
    };
    window.addEventListener('scroll', function () { if (!pTick) { pTick = true; requestAnimationFrame(lift); } }, { passive: true });
    window.addEventListener('resize', lift);
    lift();
  }

  // Reveal blocks as they enter the viewport, staggered: blocks that come into view
  // together appear one after another (top to bottom, then left to right), and a
  // quick scroll keeps the rhythm without making anything wait too long.
  var items = document.querySelectorAll('.reveal');
  var STEP = 140, MAX_WAIT = 560, nextAt = 0;
  var reveal = function (el) {
    var now = performance.now();
    var at = Math.min(Math.max(now, nextAt), now + MAX_WAIT);
    nextAt = at + STEP;
    el.style.setProperty('--reveal-delay', Math.round(at - now) + 'ms');
    el.classList.add('is-in');
  };
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries
        .filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) {
          return (a.boundingClientRect.top - b.boundingClientRect.top) || (a.boundingClientRect.left - b.boundingClientRect.left);
        })
        .forEach(function (e) { io.unobserve(e.target); reveal(e.target); });
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

  // Hidden: press G to show or hide the layout grid (24 / 8 / 4 columns). Ignored while
  // typing, and with Cmd/Ctrl/Alt. Stays on between pages for the visit.
  var gridOverlay = null, gridLabel = null;
  var describeGrid = function () {
    var cols = gridOverlay.querySelectorAll('.grid-overlay__col');
    var css = getComputedStyle(gridOverlay.firstChild);
    gridLabel.textContent = css.gridTemplateColumns.split(' ').length + ' columns · ' + Math.round(cols[0].getBoundingClientRect().width) + 'px wide · ' +
      Math.round(parseFloat(css.columnGap)) + 'px gaps · ' + Math.round(parseFloat(css.paddingLeft)) + 'px margins  (G to hide)';
  };
  var showGrid = function (on) {
    if (on && !gridOverlay) {
      gridOverlay = document.createElement('div');
      gridOverlay.className = 'grid-overlay';
      gridOverlay.setAttribute('aria-hidden', 'true');
      var inner = document.createElement('div');
      inner.className = 'grid-overlay__inner';
      for (var c = 0; c < 24; c++) {
        var col = document.createElement('span');
        col.className = 'grid-overlay__col';
        inner.appendChild(col);
      }
      gridLabel = document.createElement('span');
      gridLabel.className = 'grid-overlay__label';
      gridOverlay.appendChild(inner);
      gridOverlay.appendChild(gridLabel);
      document.body.appendChild(gridOverlay);
      window.addEventListener('resize', function () { if (gridOverlay.classList.contains('is-on')) describeGrid(); });
    }
    if (gridOverlay) {
      gridOverlay.classList.toggle('is-on', on);
      if (on) describeGrid();
    }
    try { sessionStorage.setItem('show-grid', on ? '1' : ''); } catch (e) { /* private mode */ }
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'g' && e.key !== 'G') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    showGrid(!(gridOverlay && gridOverlay.classList.contains('is-on')));
  });
  try { if (sessionStorage.getItem('show-grid') === '1') showGrid(true); } catch (e) { /* private mode */ }
})();
