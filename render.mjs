// Renders the site from content.json: the homepage plus one page per
// project case study. Shared by build.mjs (Node) and the /admin editor
// (browser), so the live preview and the published pages always match.

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
const ARROW_RIGHT =
  '<svg class="arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10M6.5 1.5L11 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

const defaultAsset = (p) => (!p ? '' : /^(https?:|data:|blob:|\/)/.test(p) ? p : '/' + p);

/* ---------- case studies ---------- */

/** True when a project has a case study page that should be published. */
export const hasCaseStudy = (p) => !!(p && !p.hidden && p.id && p.caseStudy && p.caseStudy.enabled);
export const caseStudyPath = (p) => `/work/${p.id}/`;

/** Every file the site consists of: [{ path, html }]. */
export function renderPages(c, opts = {}) {
  const pages = [{ path: 'index.html', html: renderSite(c, opts) }];
  for (const p of c.projects || []) {
    if (hasCaseStudy(p)) pages.push({ path: `work/${p.id}/index.html`, html: renderCaseStudy(c, p, opts) });
  }
  return pages;
}

/* ---------- shared pieces ---------- */

function head(c, page, opts) {
  const asset = opts.asset || defaultAsset;
  const site = c.site || {};
  const base = (site.url || '').replace(/\/+$/, '');
  const abs = (p) => (!p ? '' : /^https?:/.test(p) ? p : `${base}/${p.replace(/^\/+/, '')}`);
  const url = base ? `${base}${page.path || '/'}` : '';
  const ogImage = page.ogImage || site.ogImage;
  return `<!DOCTYPE html>
<html lang="${esc(site.lang || 'en-GB')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
${url ? `<link rel="canonical" href="${esc(url)}">\n<meta property="og:url" content="${esc(url)}">` : ''}
<meta property="og:type" content="${page.type || 'website'}">
<meta property="og:title" content="${esc(page.ogTitle || page.title)}">
<meta property="og:description" content="${esc(page.ogDescription || page.description)}">
${ogImage ? `<meta property="og:image" content="${esc(abs(ogImage))}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.ogTitle || page.title)}">
<meta name="twitter:description" content="${esc(page.ogDescription || page.description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(abs(ogImage))}">` : ''}
${site.favicon ? `<link rel="icon" href="${esc(asset(site.favicon))}">` : ''}
${site.appleTouchIcon ? `<link rel="apple-touch-icon" href="${esc(asset(site.appleTouchIcon))}">` : ''}
<meta name="theme-color" content="#1a1a1a">
<link rel="preload" href="/fonts/aqiiD4LUKkKzXdjGL5UzHq8bo5w.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<script>document.documentElement.classList.add('js')</script>
${opts.headExtra || ''}
</head>`;
}

function footer(c) {
  const f = c.footer || {};
  return `<footer class="footer reveal">
  <h2 class="section-title">${esc(f.title)}</h2>
  <ul class="footer__links">${(f.links || [])
    .filter((l) => l.label)
    .map((l) => `<li><a ${linkAttrs(l.url || '#')}>${esc(l.label)}${ARROW}</a></li>`)
    .join('')}</ul>
</footer>
<script src="/site.js" defer></script>
</body>
</html>
`;
}

function title(text, url, cls, arrow = ARROW) {
  if (!url) return `<h3 class="${cls}">${esc(text)}</h3>`;
  return `<h3 class="${cls}"><a ${linkAttrs(url)}>${esc(text)}${arrow}</a></h3>`;
}

function tags(list) {
  const items = (list || []).filter((t) => t && t.label);
  if (!items.length) return '';
  return `<ul class="tags">${items
    .map((t) => `<li class="tag${t.highlight ? ' tag--highlight' : ''}">${esc(t.label)}</li>`)
    .join('')}</ul>`;
}

/* ---------- homepage ---------- */

function project(p, asset) {
  const cs = hasCaseStudy(p);
  const href = cs ? caseStudyPath(p) : p.url;
  let img = p.image
    ? `<img src="${esc(asset(p.image))}" alt="${esc(p.imageAlt || '')}" loading="lazy" decoding="async">`
    : '';
  if (img) img = cs ? `<a class="project__media" href="${esc(href)}" tabindex="-1">${img}</a>` : `<div class="project__media">${img}</div>`;
  const id = p.id ? ` id="${esc(p.id)}"` : '';
  return `<article class="project reveal"${id}>${img}<div class="project__body">${title(p.title, href, 'project__title', cs ? ARROW_RIGHT : ARROW)}<div class="project__text">${paragraphs(p.text)}</div>${tags(p.tags)}</div></article>`;
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
  const asset = opts.asset || defaultAsset;
  const site = c.site || {};
  const visible = (c.projects || []).filter((p) => !p.hidden);
  const left = visible.filter((p) => p.column !== 'right');
  const right = visible.filter((p) => p.column === 'right');
  const hl = c.highlights || {};
  const hlItems = (hl.items || []).filter((h) => !h.hidden);
  const intro = c.intro || {};

  return `${head(c, { path: '/', title: site.title, description: site.description, ogTitle: site.ogTitle, ogDescription: site.ogDescription }, opts)}
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
    <div class="ticker"><ul class="ticker__track" style="--count:${hlItems.length}">${hlItems.map((h) => highlight(h, asset)).join('')}</ul></div>
  </section>` : ''}
</main>
${footer(c)}`;
}

/* ---------- case study page ---------- */

function figure(src, alt, caption, asset, cls = '') {
  if (!src) return '';
  return `<figure class="cs-figure ${cls}"><img src="${esc(asset(src))}" alt="${esc(alt || '')}" loading="lazy" decoding="async">${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`;
}

function block(b, asset) {
  switch (b.type) {
    case 'text':
      if (!String(b.text || '').trim()) return '';
      return `<section class="cs-block cs-text reveal">${b.heading ? `<h2 class="cs-text__heading">${esc(b.heading)}</h2>` : '<span></span>'}<div class="cs-text__body">${paragraphs(b.text)}</div></section>`;
    case 'image':
      return b.image ? `<section class="cs-block cs-image cs-image--${b.size === 'inset' ? 'inset' : 'full'} reveal">${figure(b.image, b.alt, b.caption, asset)}</section>` : '';
    case 'gallery': {
      const imgs = (b.images || []).filter((i) => i.image);
      return imgs.length ? `<section class="cs-block cs-gallery cs-gallery--${Math.min(imgs.length, 3)} reveal">${imgs.map((i) => figure(i.image, i.alt, i.caption, asset)).join('')}</section>` : '';
    }
    case 'quote':
      return b.text ? `<section class="cs-block cs-quote reveal"><blockquote><p>${inline(b.text)}</p>${b.cite ? `<footer>${inline(b.cite)}</footer>` : ''}</blockquote></section>` : '';
    case 'stats': {
      const items = (b.items || []).filter((s) => s.value || s.label);
      return items.length ? `<section class="cs-block cs-stats reveal">${b.heading ? `<h2 class="cs-text__heading">${esc(b.heading)}</h2>` : ''}<dl>${items.map((s) => `<div><dt>${esc(s.value)}</dt><dd>${inline(s.label || '')}</dd></div>`).join('')}</dl></section>` : '';
    }
    default:
      return '';
  }
}

export function renderCaseStudy(c, p, opts = {}) {
  const asset = opts.asset || defaultAsset;
  const cs = p.caseStudy || {};
  const intro = c.intro || {};
  const site = c.site || {};
  const others = (c.projects || []).filter(hasCaseStudy);
  const next = others.length > 1 ? others[(others.indexOf(p) + 1) % others.length] : null;
  const meta = (cs.meta || []).filter((m) => m.label && m.value);
  if (p.url) meta.push({ label: 'Website', value: `[${p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}](${p.url})` });
  const heroImage = cs.heroImage || p.image;
  const summary = cs.summary || p.text;
  const description = (cs.seoDescription || summary || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 300);

  return `${head(c, {
    path: caseStudyPath(p),
    type: 'article',
    title: cs.seoTitle || `${p.title} — ${intro.name || site.title || ''}`.replace(/ — $/, ''),
    description,
    ogImage: cs.ogImage || heroImage,
  }, opts)}
<body class="cs">
<nav class="cs-nav"><a href="/">${esc(intro.name || 'Home')}</a></nav>
<main>
  <header class="cs-head reveal">
    <div class="cs-head__main">
      <h1 class="cs-head__title">${esc(p.title)}</h1>
      <div class="cs-head__summary">${paragraphs(summary)}</div>
      ${tags(p.tags)}
    </div>
    ${meta.length ? `<dl class="cs-meta">${meta.map((m) => `<div><dt>${esc(m.label)}</dt><dd>${inline(m.value)}</dd></div>`).join('')}</dl>` : ''}
  </header>
  ${heroImage ? `<div class="cs-hero reveal">${figure(heroImage, cs.heroAlt || p.imageAlt, '', asset)}</div>` : ''}
  ${(cs.blocks || []).filter((b) => !b.hidden).map((b) => block(b, asset)).join('\n  ')}
  <nav class="cs-next reveal" aria-label="More work">
    ${next ? `<span class="section-title">Next case study</span><a href="${esc(caseStudyPath(next))}">${esc(next.title)}${ARROW_RIGHT}</a>` : ''}
    <a class="cs-next__home" href="/">Back to all work</a>
  </nav>
</main>
${footer(c)}`;
}
