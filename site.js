(function () {
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
      fadeEls.forEach(function (el, i) {
        var r = el.getBoundingClientRect();
        var end = -r.height / 2;
        var o = (r.top - end) / Math.max(fadeFrom[i] - end, 1);
        o = o >= 1 ? 1 : o <= 0 ? 0 : o;
        el.style.opacity = o === 1 ? '' : o.toFixed(3);
      });
    };
    var measureFade = function () {
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
    var SPEED = 0.1, wide = window.matchMedia('(min-width: 1200px)'), pTick = false;
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
})();
