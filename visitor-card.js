/*
 * Visitor card for side projects.
 *
 * Add this one line to a side project's HTML (before </body>):
 *   <script src="https://jamingalea.com/visitor-card.js" defer></script>
 *
 * When someone arrives from the portfolio, a small card animates in explaining
 * the project. The message for each domain is written in the portfolio's CMS
 * and published to /visitor-cards.json next to this script. Anyone arriving
 * from anywhere else sees nothing.
 */
(function () {
  'use strict';
  if (window.JGVisitorCard) return;

  var script = document.currentScript;
  var BASE = (function () { try { return new URL(script.src).origin; } catch (e) { return location.origin; } })();
  var PREVIEW = !!(script && script.hasAttribute('data-preview'));
  var KEY_FROM = 'jg-visitor-card:from';
  var KEY_STATE = 'jg-visitor-card:state'; // '' → card not yet shown, 'seen', 'closed'

  var session = {
    get: function (k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  var normalise = function (h) { return String(h || '').toLowerCase().replace(/^www\./, ''); };
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- did this visit come from the portfolio? ---------- */
  function arrival() {
    var tagged = false;
    try {
      var url = new URL(location.href);
      if (url.searchParams.get('from') === 'portfolio') {
        tagged = true;
        url.searchParams.delete('from'); // tidy the address bar
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      }
    } catch (e) { /* ignore */ }
    var referrer = '';
    try { referrer = normalise(new URL(document.referrer).hostname); } catch (e) { /* none */ }
    return { tagged: tagged, referrer: referrer };
  }

  /* ---------- styles (inside a shadow root, so the host page can't affect them) ---------- */
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.wrap{position:fixed;left:20px;bottom:20px;z-index:2147483646;font:300 15px/22px Inter,"JG Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}',
    '.card{width:min(360px,calc(100vw - 32px));background:#1a1a1a;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:20px 20px 18px;box-shadow:0 24px 70px rgba(0,0,0,.38),0 2px 8px rgba(0,0,0,.2);',
    '  opacity:0;transform:translateY(28px) scale(.97);transform-origin:bottom left;transition:opacity .55s cubic-bezier(.2,.8,.2,1),transform .7s cubic-bezier(.2,.8,.2,1)}',
    '.card.in{opacity:1;transform:none}',
    '.card.out{opacity:0;transform:translateY(16px) scale(.98);transition-duration:.25s,.3s;transition-timing-function:ease-in}',
    '.card>*{opacity:0;transform:translateY(8px);transition:opacity .5s ease,transform .6s cubic-bezier(.2,.8,.2,1)}',
    '.card.in>*{opacity:1;transform:none}',
    '.card.in>*:nth-child(1){transition-delay:.12s}.card.in>*:nth-child(2){transition-delay:.2s}.card.in>*:nth-child(3){transition-delay:.28s}.card.in>*:nth-child(4){transition-delay:.36s}',
    '.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}',
    '.by{display:flex;align-items:center;gap:8px;font-size:13px;line-height:18px;color:rgba(255,255,255,.55)}',
    '.dot{width:6px;height:6px;border-radius:50%;background:#fff;opacity:.8;flex:none}',
    '.close{all:unset;width:28px;height:28px;margin:-6px -8px -6px 0;border-radius:8px;display:grid;place-items:center;color:rgba(255,255,255,.55);cursor:pointer}',
    '.close:hover{background:rgba(255,255,255,.08);color:#fff}',
    '.close:focus-visible,a:focus-visible,.pill:focus-visible{outline:2px solid #fff;outline-offset:2px}',
    '.close svg{width:14px;height:14px}',
    'h2{margin:0 0 8px;font:inherit;font-size:18px;line-height:24px;font-weight:300;color:#fff}',
    '.msg{color:rgba(255,255,255,.6)}',
    '.msg p{margin:0}.msg p+p{margin-top:10px}',
    '.msg a{color:#fff;text-decoration:underline;text-decoration-color:rgba(255,255,255,.35);text-underline-offset:3px}',
    '.msg strong,.msg b{font-weight:500;color:#fff}',
    '.links{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.09)}',
    '.links a{color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:opacity .2s}',
    '.links a:hover{opacity:.7}',
    '.links svg{width:10px;height:10px}',
    '.pill{all:unset;display:inline-flex;align-items:center;gap:8px;background:#1a1a1a;color:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:8px 14px 8px 12px;font-size:13px;line-height:18px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.3);',
    '  opacity:0;transform:translateY(10px);transition:opacity .4s ease,transform .5s cubic-bezier(.2,.8,.2,1)}',
    '.pill.in{opacity:1;transform:none}',
    '.pill:hover{color:#fff}',
    '@media (max-width:480px){.wrap{left:12px;right:12px;bottom:12px}.card{width:100%}}',
    '@media (prefers-reduced-motion:reduce){.card,.card>*,.pill{transform:none!important;transition:opacity .3s ease!important}}',
  ].join('\n');

  var ICON_CLOSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var ICON_ARROW_RIGHT = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10M6.5 1.5L11 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  var ICON_ARROW_OUT = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5l7-7M3.5 2.5h6v6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

  function loadFont() {
    // The portfolio's typeface, if the host page doesn't already have Inter.
    if (document.getElementById('jg-visitor-card-font')) return;
    var style = document.createElement('style');
    style.id = 'jg-visitor-card-font';
    style.textContent =
      '@font-face{font-family:"JG Inter";src:url(' + BASE + '/fonts/aqiiD4LUKkKzXdjGL5UzHq8bo5w.woff2) format("woff2");font-weight:300;font-display:swap}' +
      '@font-face{font-family:"JG Inter";src:url(' + BASE + '/fonts/inter-latin-500-normal.woff2) format("woff2");font-weight:500;font-display:swap}';
    document.head.appendChild(style);
  }

  var el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  var text = function (tag, cls, value) { var n = el(tag, cls); n.textContent = value; return n; };
  var absolute = function (path) { try { return new URL(path, BASE + '/').href; } catch (e) { return BASE; } };

  var host = null;
  function mount() {
    if (host) host.remove();
    host = document.createElement('div');
    host.setAttribute('data-jg-visitor-card', '');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = document.createElement('style');
    style.textContent = CSS;
    var wrap = el('div', 'wrap');
    root.appendChild(style);
    root.appendChild(wrap);
    document.body.appendChild(host);
    return wrap;
  }

  /**
   * Shows the card.
   * @param {object} card   { project, heading, html, caseStudy, portfolio } from visitor-cards.json
   * @param {object} [o]    { by: 'Jamin Galea', start: 'card' | 'pill', delay: ms, onClose }
   */
  function show(card, o) {
    o = o || {};
    loadFont();
    var wrap = mount();
    var by = o.by || 'the designer';

    function close() {
      var c = wrap.firstChild;
      if (o.onClose) o.onClose();
      if (!c) return;
      c.classList.add('out');
      c.classList.remove('in');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (host) host.remove(); host = null; }, calm ? 300 : 320);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    function renderCard(delay) {
      var c = el('section', 'card');
      c.setAttribute('role', 'dialog');
      c.setAttribute('aria-modal', 'false');
      c.setAttribute('aria-labelledby', 'jg-vc-title');

      var top = el('div', 'top');
      var byline = el('div', 'by');
      byline.appendChild(el('span', 'dot'));
      byline.appendChild(document.createTextNode('A project by ' + by));
      var x = el('button', 'close', ICON_CLOSE);
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', close);
      top.appendChild(byline);
      top.appendChild(x);

      var h = text('h2', '', card.heading || card.project || '');
      h.id = 'jg-vc-title';
      var msg = el('div', 'msg', card.html || '');
      msg.querySelectorAll('a').forEach(function (a) { a.target = '_blank'; a.rel = 'noopener'; });

      var links = el('div', 'links');
      if (card.caseStudy) {
        var cs = el('a', '', 'Read the case study ' + ICON_ARROW_RIGHT);
        cs.href = absolute(card.caseStudy);
        cs.target = '_blank';
        cs.rel = 'noopener';
        links.appendChild(cs);
      }
      var back = el('a', '', 'More of my work ' + ICON_ARROW_OUT);
      back.href = absolute(card.portfolio || '/');
      back.target = '_blank';
      back.rel = 'noopener';
      links.appendChild(back);

      c.appendChild(top);
      c.appendChild(h);
      c.appendChild(msg);
      c.appendChild(links);
      wrap.replaceChildren ? wrap.replaceChildren(c) : (wrap.innerHTML = '', wrap.appendChild(c));
      document.addEventListener('keydown', onKey);
      // Double rAF so the starting position is painted before animating in.
      setTimeout(function () {
        requestAnimationFrame(function () { requestAnimationFrame(function () { c.classList.add('in'); }); });
      }, delay || 0);
    }

    function renderPill() {
      var p = text('button', 'pill', '');
      p.type = 'button';
      p.appendChild(el('span', 'dot'));
      p.appendChild(document.createTextNode('From ' + by + '’s portfolio'));
      p.setAttribute('aria-label', 'About this project, from ' + by + '’s portfolio');
      p.addEventListener('click', function () { renderCard(0); });
      wrap.replaceChildren ? wrap.replaceChildren(p) : (wrap.innerHTML = '', wrap.appendChild(p));
      setTimeout(function () { requestAnimationFrame(function () { p.classList.add('in'); }); }, o.delay || 0);
    }

    if (o.start === 'pill') renderPill();
    else renderCard(o.delay != null ? o.delay : 900);
    return { close: close };
  }

  window.JGVisitorCard = { show: show };
  if (PREVIEW) return; // the CMS calls show() itself

  /* ---------- automatic behaviour on side projects ---------- */
  function start() {
    var state = session.get(KEY_STATE);
    if (state === 'closed') return;
    var a = arrival();

    fetch(BASE + '/visitor-cards.json', { mode: 'cors', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.cards) return;
        var card = data.cards[normalise(location.hostname)];
        if (!card) return;
        var portfolioHosts = [normalise(new URL(BASE).hostname)].concat((data.portfolioHosts || []).map(normalise));
        var fromPortfolio = a.tagged || portfolioHosts.indexOf(a.referrer) !== -1 || session.get(KEY_FROM) === '1';
        if (!fromPortfolio) return;
        session.set(KEY_FROM, '1');
        // First page of the visit: the full card. Later pages: a small pill that reopens it.
        show(card, {
          by: data.by,
          start: state === 'seen' ? 'pill' : 'card',
          delay: state === 'seen' ? 300 : 900,
          onClose: function () { session.set(KEY_STATE, 'closed'); },
        });
        if (!state) session.set(KEY_STATE, 'seen');
      })
      .catch(function () { /* the card is optional; never break the host page */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
