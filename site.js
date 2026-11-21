(function () {
  // Fade the hero out as the work scrolls over it. A hero taller than the screen
  // scrolls normally until its last line is in view, then pins and starts to fade,
  // so the whole intro can be read first.
  var hero = document.querySelector('.hero');
  if (hero) {
    var ticking = false, overflow = 0;
    var measure = function () {
      // pin with a little room under the last line, not flush with the bottom of the screen
      overflow = Math.max(0, hero.offsetHeight + Math.round(window.innerHeight * 0.12) - window.innerHeight);
      hero.style.top = overflow ? -overflow + 'px' : '';
    };
    var update = function () {
      var o = Math.max(0, 1 - Math.max(0, window.scrollY - overflow) / (window.innerHeight * 0.55));
      hero.style.opacity = o.toFixed(3);
      hero.style.visibility = o === 0 ? 'hidden' : '';
      ticking = false;
    };
    var refresh = function () { measure(); update(); };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', refresh);
    if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(hero);
    if (document.fonts) document.fonts.ready.then(refresh);
    refresh();
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
