// Renders the whole portfolio page from content.json.
// Shared by build.mjs (Node) and the /admin editor (browser), so the live
// preview and the published page are always produced by the same code.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const isExternal = (url) => /^https?:\/\//i.test(url);
const linkAttrs = (url) =>
  `href="${esc(url)}"` + (isExternal(url) ? ' target="_blank" rel="noopener"' : '');

// Inline formatting: [label](url) becomes a link, single newlines become <br>.
export function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
      `<a ${linkAttrs(url.replace(/&amp;/g, '&'))}>${label}</a>`)
    .replace(/\n/g, '<br>');
}

// Blank lines separate paragraphs.
export function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${inline(p)}</p>`)
    .join('');
}

const ARROW =
  '<svg class="arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5l7-7M3.5 2.5h6v6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

function title(text, url, cls) {
  if (!url) return `<h3 class="${cls}">${esc(text)}</h3>`;
  return `<h3 class="${cls}"><a ${linkAttrs(url)}>${esc(text)}${ARROW}</a></h3>`;
}

function tags(list) {
  const items = (list || []).filter((t) => t && t.label);
  if (!items.length) return '';
  return `<ul class="tags">${items
    .map((t) => `<li class="tag${t.highlight ? ' tag--highlight' : ''}">${esc(t.label)}</li>`)
    .join('')}</ul>`;
}

function project(p, asset) {
  const img = p.image
    ? `<div class="project__media"><img src="${esc(asset(p.image))}" alt="${esc(p.imageAlt || '')}" loading="lazy" decoding="async"></div>`
    : '';
  const id = p.id ? ` id="${esc(p.id)}"` : '';
  return `<article class="project reveal"${id}>${img}<div class="project__body">${title(p.title, p.url, 'project__title')}<div class="project__text">${paragraphs(p.text)}</div>${tags(p.tags)}</div></article>`;
}

function highlight(h, asset) {
  const icon = h.icon
    ? `<img class="highlight__icon" src="${esc(asset(h.icon))}" alt="" loading="lazy">`
    : '';
  return `<li class="highlight">${icon}${title(h.title, h.url, 'highlight__title')}<div class="highlight__text">${paragraphs(h.text)}</div>${tags(h.tags)}</li>`;
}

/**
 * @param {object} c       content.json
 * @param {object} [opts]
 * @param {(path:string)=>string} [opts.asset]  maps a stored path ("images/x.png") to a URL
 * @param {string} [opts.headExtra]             extra markup for <head> (used by the preview)
 */
export function renderSite(c, opts = {}) {
  const asset = opts.asset || ((p) => (/^(https?:|data:|blob:|\/)/.test(p) ? p : '/' + p));
  const site = c.site || {};
  const base = (site.url || '').replace(/\/+$/, '');
  const abs = (p) => (!p ? '' : /^https?:/.test(p) ? p : `${base}/${p.replace(/^\/+/, '')}`);
  const visible = (c.projects || []).filter((p) => !p.hidden);
  const left = visible.filter((p) => p.column !== 'right');
  const right = visible.filter((p) => p.column === 'right');
  const hl = c.highlights || {};
  const hlItems = (hl.items || []).filter((h) => !h.hidden);
  const hlHtml = hlItems.map((h) => highlight(h, asset)).join('');
  const footer = c.footer || {};
  const intro = c.intro || {};

  return `<!DOCTYPE html>
<html lang="${esc(site.lang || 'en-GB')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.title)}</title>
<meta name="description" content="${esc(site.description)}">
${base ? `<link rel="canonical" href="${esc(base)}/">\n<meta property="og:url" content="${esc(base)}/">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(site.ogTitle || site.title)}">
<meta property="og:description" content="${esc(site.ogDescription || site.description)}">
${site.ogImage ? `<meta property="og:image" content="${esc(abs(site.ogImage))}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(site.ogTitle || site.title)}">
<meta name="twitter:description" content="${esc(site.ogDescription || site.description)}">
${site.ogImage ? `<meta name="twitter:image" content="${esc(abs(site.ogImage))}">` : ''}
${site.favicon ? `<link rel="icon" href="${esc(asset(site.favicon))}">` : ''}
${site.appleTouchIcon ? `<link rel="apple-touch-icon" href="${esc(asset(site.appleTouchIcon))}">` : ''}
<meta name="theme-color" content="#1a1a1a">
<link rel="preload" href="/fonts/aqiiD4LUKkKzXdjGL5UzHq8bo5w.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<script>document.documentElement.classList.add('js')</script>
${opts.headExtra || ''}
</head>
<body>
<header class="hero">
  <div class="hero__intro">
    <h1 class="hero__name">${esc(intro.name)}</h1>
    <div class="hero__tagline">${paragraphs(intro.tagline)}</div>
  </div>
  <div class="hero__bio">${paragraphs(intro.bio)}</div>
</header>
<main>
  <section class="work" aria-label="Selected work">
    <div class="work__col work__col--left">${left.map((p) => project(p, asset)).join('')}</div>
    <div class="work__col work__col--right">${right.map((p) => project(p, asset)).join('')}</div>
  </section>
  ${hlItems.length ? `<section class="highlights reveal" aria-label="${esc(hl.title || 'Highlights')}">
    <h2 class="section-title">${esc(hl.title)}</h2>
    <div class="ticker"><ul class="ticker__track" style="--count:${hlItems.length}">${hlHtml}</ul></div>
  </section>` : ''}
</main>
<footer class="footer reveal">
  <h2 class="section-title">${esc(footer.title)}</h2>
  <ul class="footer__links">${(footer.links || [])
    .filter((l) => l.label)
    .map((l) => `<li><a ${linkAttrs(l.url || '#')}>${esc(l.label)}${ARROW}</a></li>`)
    .join('')}</ul>
</footer>
<script src="/site.js" defer></script>
</body>
</html>
`;
}
