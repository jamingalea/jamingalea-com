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
})();
