// Renders the site from content.json: the homepage plus one page per
// project case study. Shared by build.mjs (Node) and the /admin editor
// (browser), so the live preview and the published pages always match.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const isExternal = (url) => /^https?:\/\//i.test(url);

// Links to side projects that show a visitor card get ?from=portfolio, so the card
// still appears when a browser hides where the visitor came from. Set per render.
let cardHosts = new Set();
const tagForCard = (url) => {
  if (!isExternal(url) || !cardHosts.size) return url;
  try {
    const u = new URL(url);
    if (!cardHosts.has(normaliseHost(u.hostname))) return url;
    u.searchParams.set('from', 'portfolio');
    return u.toString();
  } catch { return url; }
};
const linkAttrs = (url) =>
  `href="${esc(tagForCard(url))}"` + (isExternal(url) ? ' target="_blank" rel="noopener"' : '');

// Inline formatting (what the CMS editor writes):
//   [label](url)  link        **text**  bold        _text_ or *text*  italic
//   \*  \_  \[  \]  \\        a literal character    a single newline  line break
const LITERAL = /\\([\\*_[\]])/g;
export function inline(text) {
  const lit = [];
  const s = esc(String(text ?? '').replace(LITERAL, (_, c) => `\u0000${lit.push(c) - 1}\u0000`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
      `<a ${linkAttrs(url.replace(/&amp;/g, '&'))}>${label}</a>`)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => esc(lit[i]));
}

/** The text without any formatting marks (for meta descriptions). */
export function plainText(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
    .replace(/(^|\W)[_*](?=\S)([\s\S]*?\S)[_*](?!\w)/g, '$1$2')
    .replace(LITERAL, '$1');
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

// Vercel Web Analytics: cookieless page-view counting, read by the CMS's Analytics tab.
// Left out of the CMS preview so editing doesn't count as visits.
const ANALYTICS = `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
<script defer src="/_vercel/insights/script.js"></script>`;

const defaultAsset =(p) => (!p ? '' : /^(https?:|data:|blob:|\/)/.test(p) ? p : '/' + p);

/* ---------- case studies ---------- */
// content.caseStudies = [{ id, title, project, enabled, unlisted, summary, heroImage, … }]
// `project` is the id of the homepage project it belongs to. A listed case study is
// reached from that project; an unlisted one is only reachable by its link.

/** Moves case studies from the old shape (project.caseStudy) to content.caseStudies. */
export function migrate(c) {
  c.caseStudies ||= [];
  for (const p of c.projects || []) {
    if (!p.caseStudy) continue;
    const { enabled, ...rest } = p.caseStudy;
    if (!c.caseStudies.some((cs) => cs.project === p.id)) {
      c.caseStudies.push({ id: p.id, title: '', project: p.id, enabled: !!enabled, unlisted: false, ...rest });
    }
    delete p.caseStudy;
  }
  return c;
}

export const caseStudyPath = (cs) => `/work/${cs.id}/`;
export const projectOf = (c, cs) => (cs && cs.project ? (c.projects || []).find((p) => p.id === cs.project) : null) || null;
export const caseStudyTitle = (c, cs) => cs.title || projectOf(c, cs)?.title || 'Untitled case study';

/** Why a case study isn't on the site, or '' when it is. */
export function caseStudyProblem(c, cs) {
  if (!cs.enabled) return 'draft';
  if (!cs.id) return 'no-address';
  if (cs.unlisted) return projectOf(c, cs) || cs.title ? '' : 'no-title';
  const p = projectOf(c, cs);
  if (!p) return 'no-project';
  if (p.hidden) return 'project-hidden';
  return '';
}
export const isLive = (c, cs) => !caseStudyProblem(c, cs);

/** The live, listed case study a homepage project links to, if any. */
export const caseStudyFor = (c, p) =>
  (c.caseStudies || []).find((cs) => cs.project === p.id && !cs.unlisted && isLive(c, cs)) || null;

/** Every file the site consists of: [{ path, html }]. */
export function renderPages(c, opts = {}) {
  c = migrate(JSON.parse(JSON.stringify(c)));
  const pages = [{ path: 'index.html', html: renderSite(c, opts) }];
  for (const cs of c.caseStudies) {
    if (isLive(c, cs)) pages.push({ path: `work/${cs.id}/index.html`, html: renderCaseStudy(c, cs, opts) });
  }
  pages.push({ path: 'visitor-cards.json', html: JSON.stringify(visitorCards(c), null, 2) + '\n' });
  return pages;
}

/* ---------- visitor cards ----------
   project.visitorCard = { enabled, heading, message, domains }
   A card appears on the project's own site (the domain of its link, plus any extra
   domains) when someone arrives from the portfolio. visitor-card.js reads the file
   below; its links are relative, resolved against wherever the portfolio is hosted. */

export function normaliseHost(h) {
  return String(h || '').trim().toLowerCase()
    .replace(/^[a-z][\w+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
}

/** The domains a project's visitor card appears on. */
export function cardDomains(p) {
  const out = new Set();
  if (p.url && isExternal(p.url)) out.add(normaliseHost(p.url));
  for (const d of String(p.visitorCard?.domains || '').split(/[\s,]+/)) if (normaliseHost(d)) out.add(normaliseHost(d));
  return [...out].filter((d) => d.includes('.'));
}

const cardOn = (p) => !!(p.visitorCard?.enabled && String(p.visitorCard.message || '').trim());

export function visitorCards(c) {
  const name = c.intro?.name || '';
  let portfolioHost = '';
  try { portfolioHost = normaliseHost(new URL(c.site?.url).hostname); } catch { /* none */ }
  const cards = {};
  for (const p of c.projects || []) {
    if (!cardOn(p)) continue;
    const study = (c.caseStudies || []).filter((cs) => cs.project === p.id && isLive(c, cs))
      .sort((a, b) => Number(!!a.unlisted) - Number(!!b.unlisted))[0];
    const card = {
      project: p.title || '',
      heading: p.visitorCard.heading || '',
      html: paragraphs(p.visitorCard.message),
      caseStudy: study ? caseStudyPath(study) : '',
      portfolio: p.hidden || !p.id ? '/' : `/#${p.id}`,
    };
    for (const d of cardDomains(p)) cards[d] = card;
  }
  return { version: 1, by: name, portfolioHosts: portfolioHost ? [portfolioHost] : [], cards };
}

const setCardHosts = (c) => {
  cardHosts = new Set((c.projects || []).filter(cardOn).flatMap(cardDomains));
};

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
${page.noindex ? '<meta name="robots" content="noindex">\n' : ''}${url ? `<link rel="canonical" href="${esc(url)}">\n<meta property="og:url" content="${esc(url)}">` : ''}
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
${opts.preview ? '' : ANALYTICS}
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

// Focal point {x, y} in % → inline style that keeps that spot in view when the
// image is cropped (object-fit: cover). Centre (the default) needs no style.
export function focusStyle(f) {
  if (!f || typeof f !== 'object') return '';
  const n = (v) => Math.min(100, Math.max(0, Math.round(Number(v) * 10) / 10));
  const x = n(f.x), y = n(f.y);
  if (Number.isNaN(x) || Number.isNaN(y) || (x === 50 && y === 50)) return '';
  return ` style="object-position:${x}% ${y}%;transform-origin:${x}% ${y}%"`;
}

function project(p, asset, c) {
  const study = caseStudyFor(c, p);
  const cs = !!study;
  const href = cs ? caseStudyPath(study) : p.url;
  let img = p.image
    ? `<img src="${esc(asset(p.image))}" alt="${esc(p.imageAlt || '')}"${focusStyle(p.imageFocus)} loading="lazy" decoding="async">`
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
  setCardHosts(c);
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
    <div class="work__col work__col--left">${left.map((p) => project(p, asset, c)).join('')}</div>
    <div class="work__col work__col--right">${right.map((p) => project(p, asset, c)).join('')}</div>
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

export function renderCaseStudy(c, cs, opts = {}) {
  const asset = opts.asset || defaultAsset;
  c = migrate(c);
  setCardHosts(c);
  const p = projectOf(c, cs) || {};
  const intro = c.intro || {};
  const site = c.site || {};
  // "Next case study" only cycles through listed ones, so unlisted pages stay private.
  const listed = c.caseStudies.filter((x) => !x.unlisted && isLive(c, x));
  const at = listed.indexOf(cs);
  const next = at === -1 ? listed[0] || null : listed.length > 1 ? listed[(at + 1) % listed.length] : null;
  const meta = (cs.meta || []).filter((m) => m.label && m.value);
  if (p.url) meta.push({ label: 'Website', value: `[${p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}](${p.url})` });
  const title = caseStudyTitle(c, cs);
  const heroImage = cs.heroImage || p.image;
  const summary = cs.summary || p.text;
  const description = plainText(cs.seoDescription || summary || '').replace(/\s+/g, ' ').trim().slice(0, 300);

  return `${head(c, {
    path: caseStudyPath(cs),
    type: 'article',
    title: cs.seoTitle || `${title} — ${intro.name || site.title || ''}`.replace(/ — $/, ''),
    description,
    ogImage: cs.ogImage || heroImage,
    noindex: !!cs.unlisted,
  }, opts)}
<body class="cs">
<nav class="cs-nav"><a href="/">${esc(intro.name || 'Home')}</a></nav>
<main>
  <header class="cs-head reveal">
    <div class="cs-head__main">
      <h1 class="cs-head__title">${esc(title)}</h1>
      <div class="cs-head__summary">${paragraphs(summary)}</div>
      ${tags(p.tags)}
    </div>
    ${meta.length ? `<dl class="cs-meta">${meta.map((m) => `<div><dt>${esc(m.label)}</dt><dd>${inline(m.value)}</dd></div>`).join('')}</dl>` : ''}
  </header>
  ${heroImage ? `<div class="cs-hero reveal">${figure(heroImage, cs.heroAlt || p.imageAlt, '', asset)}</div>` : ''}
  ${(cs.blocks || []).filter((b) => !b.hidden).map((b) => block(b, asset)).join('\n  ')}
  <nav class="cs-next reveal" aria-label="More work">
    ${next ? `<span class="section-title">Next case study</span><a href="${esc(caseStudyPath(next))}">${esc(caseStudyTitle(c, next))}${ARROW_RIGHT}</a>` : ''}
    <a class="cs-next__home" href="/">Back to all work</a>
  </nav>
</main>
${footer(c)}`;
}
