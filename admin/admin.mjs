// Portfolio CMS — edits content.json, previews it live, and publishes
// content.json + a regenerated index.html (+ any new images) to GitHub
// in a single commit. Vercel redeploys on push.
import { renderSite } from '/render.mjs';

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// h('div.cls', {attrs}, ...children)
function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (attrs.constructor !== Object)) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';

function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.replaceChildren(...(Array.isArray(msg) ? msg : [msg]));
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- base64 ---------- */
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const textToB64 = (t) => bytesToB64(new TextEncoder().encode(t));
const b64ToText = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

/* ---------- pending images (kept in IndexedDB so drafts survive reloads) ---------- */
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('portfolio-cms', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('images');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('images', mode);
      const out = fn(t.objectStore('images'));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  put(k, v) { return this.tx('readwrite', (s) => s.put(v, k)).catch(() => {}); },
  del(k) { return this.tx('readwrite', (s) => s.delete(k)).catch(() => {}); },
  clear() { return this.tx('readwrite', (s) => s.clear()).catch(() => {}); },
  async all() {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const out = {};
        const req = db.transaction('images').objectStore('images').openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
        req.onerror = () => rej(req.error);
      });
    } catch { return {}; }
  },
};

/* ---------- state ---------- */
const DEFAULT_CONN = { owner: 'jamingalea', repo: 'jamingalea-com', branch: 'main', token: '' };
const state = {
  conn: { ...DEFAULT_CONN, ...store.get('cms-conn', {}) },
  published: null,        // content as last loaded from GitHub / the site
  publishedSha: null,     // blob sha of content.json we based our edits on
  content: null,          // working copy
  pending: new Map(),     // path -> { blob, url }
  tab: store.get('cms-tab', 'projects'),
  open: new Set(),        // expanded cards (object refs)
  device: store.get('cms-device', 'desktop'),
};

/* ---------- GitHub API ---------- */
async function gh(path, opts = {}) {
  const { owner, repo, token } = state.conn;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
    const hint = res.status === 401 ? 'The token is invalid or expired.'
      : res.status === 403 ? 'The token lacks permission (needs Contents: Read and write).'
      : res.status === 404 ? 'Repository or branch not found, or the token cannot see it.'
      : res.status === 409 || res.status === 422 ? 'GitHub rejected the update.' : '';
    const err = new Error(`${hint} ${detail ? `(${detail})` : `(HTTP ${res.status})`}`.trim());
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function loadFromGitHub() {
  const { branch } = state.conn;
  const file = await gh(`/contents/content.json?ref=${encodeURIComponent(branch)}`);
  return { content: JSON.parse(b64ToText(file.content)), sha: file.sha };
}

async function loadFromSite() {
  const res = await fetch('/content.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load /content.json');
  return { content: await res.json(), sha: null };
}

/* ---------- loading & drafts ---------- */
async function load({ keepDraft = true } = {}) {
  let base;
  const connected = !!state.conn.token;
  try {
    base = connected ? await loadFromGitHub() : await loadFromSite();
  } catch (e) {
    toast(`Couldn't load from GitHub: ${e.message} Showing the site's current content instead.`, 7000);
    base = await loadFromSite();
  }
  state.published = base.content;
  state.publishedSha = base.sha;

  const draft = keepDraft ? store.get('cms-draft', null) : null;
  if (draft && draft.content) {
    state.content = draft.content;
    if (state.publishedSha && draft.baseSha && draft.baseSha !== state.publishedSha) {
      toast('Restored your unpublished draft. Note: the site was changed elsewhere since you started it — publishing will replace those changes.', 9000);
    } else if (JSON.stringify(draft.content) !== JSON.stringify(base.content)) {
      toast('Restored your unpublished draft.');
    }
    const imgs = await idb.all();
    for (const [path, blob] of Object.entries(imgs)) state.pending.set(path, { blob, url: URL.createObjectURL(blob) });
  } else {
    state.content = clone(base.content);
  }
  normalise(state.content);
  updateConn();
  renderPanel();
  changed({ save: false });
}

function normalise(c) {
  c.site ||= {}; c.intro ||= {}; c.projects ||= [];
  c.highlights ||= { title: 'Other highlights', items: [] }; c.highlights.items ||= [];
  c.footer ||= { title: 'More information', links: [] }; c.footer.links ||= [];
  for (const p of c.projects) { p.tags ||= []; p.column ||= 'left'; p.id ||= uniqueId(p.title, p); }
  for (const i of c.highlights.items) i.tags ||= [];
}

function uniqueId(title, self) {
  const base = slugify(title);
  const taken = new Set((state.content?.projects || []).filter((p) => p !== self).map((p) => p.id));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

// Only images still referenced by content get published.
function referencedPaths(c) {
  const s = JSON.stringify(c);
  return [...state.pending.keys()].filter((p) => s.includes(JSON.stringify(p)));
}

function isDirty() {
  return JSON.stringify(state.content) !== JSON.stringify(state.published);
}

let saveTimer;
function changed({ save = true } = {}) {
  if (save) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set('cms-draft', { content: state.content, baseSha: state.publishedSha }), 250);
  }
  const dirty = isDirty();
  const d = $('#dirty');
  d.hidden = !dirty;
  d.textContent = dirty ? '● Unpublished changes' : '';
  $('#btn-publish').disabled = !dirty;
  schedulePreview();
}

/* ---------- preview ---------- */
let previewTimer;
const PREVIEW_HEAD = `<base target="_blank"><style>.js .reveal{opacity:1!important;transform:none!important;transition:none!important}</style>`;
function assetUrl(p) {
  if (!p) return '';
  if (state.pending.has(p)) return state.pending.get(p).url;
  return /^(https?:|data:|blob:|\/)/.test(p) ? p : '/' + p;
}
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 200);
}
function renderPreview() {
  const frame = $('#preview');
  let y = 0;
  try { y = frame.contentWindow.scrollY; } catch { /* not ready */ }
  frame.onload = () => {
    try {
      frame.contentWindow.scrollTo(0, y);
      if (state.scrollTo) {
        const el = frame.contentDocument.getElementById(state.scrollTo);
        if (el) el.scrollIntoView({ block: 'start' });
        state.scrollTo = null;
      }
    } catch { /* ignore */ }
  };
  frame.srcdoc = renderSite(state.content, { asset: assetUrl, headExtra: PREVIEW_HEAD });
}

/* ---------- images ---------- */
const IMAGE_RULES = {
  project: { max: 2400, label: 'Project image' },
  icon: { max: 400, label: 'Icon' },
  og: { max: 1200, jpeg: true, label: 'Social image' },
  favicon: { max: 256, png: true, label: 'Icon' },
};

async function processImage(file, kind) {
  const rule = IMAGE_RULES[kind] || IMAGE_RULES.project;
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const extOf = (t) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[t] || 'png');
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return { blob: file, ext: extOf(file.type) };

  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, rule.max / Math.max(bmp.width, bmp.height));
  const small = file.size < 900 * 1024 && scale === 1;
  const okType = rule.jpeg ? /jpeg|png/.test(file.type) : rule.png ? file.type === 'image/png' : true;
  if (small && okType) return { blob: file, ext: extOf(file.type), w: bmp.width, h: bmp.height };

  const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: hgt });
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  const type = rule.png ? 'image/png' : rule.jpeg ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise((r) => canvas.toBlob(r, type, 0.86));
  return { blob, ext: extOf(type), w, h: hgt };
}

async function addImage(file, kind, nameHint) {
  const { blob, ext, w, h: hgt } = await processImage(file, kind);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `images/${slugify(nameHint || file.name.replace(/\.[^.]+$/, ''))}-${rand}.${ext}`;
  state.pending.set(path, { blob, url: URL.createObjectURL(blob) });
  await idb.put(path, blob);
  return { path, w, h: hgt };
}

/* ---------- field builders ---------- */
function bind(obj, key, el, { onInput } = {}) {
  el.addEventListener('input', () => {
    obj[key] = el.type === 'checkbox' ? el.checked : el.value;
    onInput?.(el.value);
    changed();
  });
  return el;
}

function text(label, obj, key, opts = {}) {
  const input = h('input', { type: opts.type || 'text', value: obj[key] ?? '', placeholder: opts.placeholder });
  const count = opts.limit ? h('span.count') : null;
  const upd = () => {
    if (!count) return;
    const n = (input.value || '').length;
    count.textContent = `${n} / ${opts.limit}`;
    count.classList.toggle('over', n > opts.limit);
  };
  bind(obj, key, input, { onInput: (v) => { upd(); opts.onInput?.(v); } });
  upd();
  return h('label', h('span', label, count), input, opts.hint && h('small', opts.hint));
}

function area(label, obj, key, opts = {}) {
  const ta = h('textarea', { rows: opts.rows || 6, placeholder: opts.placeholder }); ta.value = obj[key] ?? '';
  const count = opts.limit ? h('span.count') : null;
  const upd = () => { if (count) { const n = ta.value.length; count.textContent = `${n} / ${opts.limit}`; count.classList.toggle('over', n > opts.limit); } };
  bind(obj, key, ta, { onInput: upd }); upd();
  return h('label', h('span', label, count), ta,
    h('small', opts.hint ?? 'Leave a blank line between paragraphs. Add a link with [link text](https://…).'));
}

function select(label, obj, key, options, onChange) {
  const sel = h('select', options.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = obj[key] ?? options[0][0];
  sel.addEventListener('change', () => { obj[key] = sel.value; changed(); onChange?.(); });
  return h('label', label, sel);
}

function imageField(label, obj, key, kind, opts = {}) {
  const pv = h('div.imgfield__preview' + (opts.contain ? '.contain' : ''));
  const path = h('div.imgfield__path');
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const removeBtn = h('button.btn.btn--sm.btn--ghost.btn--danger', { type: 'button' }, 'Remove');
  const upd = () => {
    const v = obj[key];
    pv.style.backgroundImage = v ? `url("${assetUrl(v)}")` : '';
    pv.textContent = v ? '' : 'No image';
    path.textContent = v ? (state.pending.has(v) ? 'New image (publish to upload)' : v) : '';
    removeBtn.hidden = !v || opts.required;
  };
  const take = async (f) => {
    if (!f) return;
    try {
      const { path: p, w, h: hgt } = await addImage(f, kind, opts.nameHint?.() || label);
      obj[key] = p;
      if (opts.onSize && w) opts.onSize(w, hgt);
      upd(); changed(); opts.onChange?.();
    } catch (e) { toast(e.message || String(e)); }
  };
  file.addEventListener('change', () => { take(file.files[0]); file.value = ''; });
  removeBtn.addEventListener('click', () => { obj[key] = ''; upd(); changed(); opts.onChange?.(); });
  const wrap = h('div.imgfield', pv, h('div.imgfield__side',
    h('span.imgfield__label', label),
    opts.hint && h('span.hint', opts.hint),
    h('div.row', h('button.btn.btn--sm', { type: 'button', onclick: () => file.click() }, 'Upload…'), removeBtn),
    path, file));
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drop'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
  wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('drop'); take(e.dataTransfer.files[0]); });
  upd();
  return wrap;
}

function tagsField(list) {
  const box = h('div.tags-ed');
  const draw = () => {
    box.replaceChildren(
      h('span', { style: { fontWeight: 500 } }, 'Tags'),
      ...list.map((t, i) => h('div.tag-row',
        bind(t, 'label', h('input', { type: 'text', value: t.label, placeholder: 'e.g. 0-1' })),
        h('label.check', bind(t, 'highlight', h('input', { type: 'checkbox', checked: !!t.highlight })), 'Green'),
        h('button.icon-btn', { type: 'button', title: 'Move left', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); changed(); } }, '↑'),
        h('button.icon-btn', { type: 'button', title: 'Remove tag', onclick: () => { list.splice(i, 1); draw(); changed(); } }, '✕'))),
      h('div', h('button.btn.btn--sm', { type: 'button', onclick: () => { list.push({ label: '' }); draw(); changed(); $$('input[type=text]', box).pop()?.focus(); } }, '+ Add tag')));
  };
  draw();
  return box;
}

// Collapsible card with reorder / duplicate / hide / delete tools.
function card(item, { thumb, thumbIcon, title, subtitle, onMove, canUp, canDown, onDuplicate, onDelete, body, scrollId }) {
  const isOpen = state.open.has(item);
  const head = h('div.card__head', { role: 'button', tabindex: 0, 'aria-expanded': String(isOpen) },
    h('img.card__thumb' + (thumbIcon ? '.card__thumb--icon' : ''), { src: thumb ? assetUrl(thumb) : 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: '' }),
    h('div.card__title', title || 'Untitled', item.hidden && h('span.badge', 'Hidden'), subtitle && h('span.muted', subtitle)),
    h('div.card__tools',
      h('button.icon-btn', { type: 'button', title: 'Move up', disabled: !canUp, onclick: (e) => { e.stopPropagation(); onMove(-1); } }, '↑'),
      h('button.icon-btn', { type: 'button', title: 'Move down', disabled: !canDown, onclick: (e) => { e.stopPropagation(); onMove(1); } }, '↓'),
      h('button.icon-btn', { type: 'button', title: item.hidden ? 'Show on site' : 'Hide from site', onclick: (e) => { e.stopPropagation(); item.hidden = !item.hidden; if (!item.hidden) delete item.hidden; changed(); renderPanel(); } }, item.hidden ? '◌' : '◉'),
      h('button.icon-btn', { type: 'button', title: 'Duplicate', onclick: (e) => { e.stopPropagation(); onDuplicate(); } }, '⧉'),
      h('button.icon-btn', { type: 'button', title: 'Delete', onclick: (e) => { e.stopPropagation(); if (confirm(`Delete “${title || 'Untitled'}”? You can still discard this before publishing.`)) onDelete(); } }, '🗑')));
  const toggle = () => {
    if (state.open.has(item)) state.open.delete(item); else { state.open.add(item); if (scrollId) { state.scrollTo = scrollId; schedulePreview(); } }
    renderPanel();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  return h('div.card' + (item.hidden ? '.is-hidden' : ''), head, isOpen && h('div.card__body', body()));
}

function move(list, i, to) {
  if (to < 0 || to >= list.length) return;
  list.splice(to, 0, list.splice(i, 1)[0]);
  changed(); renderPanel();
}

/* ---------- panels ---------- */
const panels = {
  projects() {
    const c = state.content;
    const list = c.projects;
    const group = (col, heading, hint) => {
      const idx = list.map((p, i) => [p, i]).filter(([p]) => (p.column === 'right' ? 'right' : 'left') === col);
      return [
        h('h3.group', heading),
        h('p.hint', hint),
        h('div.list', idx.map(([p, i], k) => card(p, {
          thumb: p.image, title: p.title, scrollId: p.id,
          canUp: k > 0, canDown: k < idx.length - 1,
          onMove: (d) => { const j = idx[k + d][1]; [list[i], list[j]] = [list[j], list[i]]; changed(); renderPanel(); },
          onDuplicate: () => { const copy = clone(p); copy.title = `${p.title} (copy)`; copy.id = uniqueId(copy.title); list.splice(i + 1, 0, copy); state.open.add(copy); changed(); renderPanel(); },
          onDelete: () => { list.splice(i, 1); changed(); renderPanel(); },
          body: () => [
            text('Title', p, 'title', { onInput: () => { const t = $('.card__title', document.activeElement.closest('.card')); if (t) t.firstChild.textContent = p.title || 'Untitled'; } }),
            text('Link', p, 'url', { type: 'url', placeholder: 'https://… (optional)', hint: 'When set, the title links here and shows an arrow.' }),
            imageField('Image', p, 'image', 'project', {
              hint: col === 'left' ? 'Shown at 1896 × 1456 (landscape, cropped to fit).' : 'Shown square, cropped to fit.',
              nameHint: () => p.title, onChange: renderPanel,
            }),
            text('Image description (alt text)', p, 'imageAlt', { hint: 'Describes the image for screen readers and search engines.' }),
            area('Description', p, 'text', { rows: 8 }),
            tagsField(p.tags),
            select('Column', p, 'column', [['left', 'Left — large landscape image'], ['right', 'Right — square image']], renderPanel),
          ],
        }))),
        h('button.btn.add', { type: 'button', onclick: () => {
          const p = { id: '', title: 'New project', url: '', image: '', imageAlt: '', column: col, text: '', tags: [] };
          p.id = uniqueId(p.title, p);
          list.push(p); state.open.add(p); state.scrollTo = p.id; changed(); renderPanel();
        } }, `+ Add project to ${col} column`),
      ];
    };
    return [
      h('p.intro', 'Projects appear in two columns. Open a project to edit it; use the arrows to reorder, ◉ to hide without deleting.'),
      group('left', 'Left column', 'Large landscape images.'),
      group('right', 'Right column', 'Square images, starting a little lower.'),
    ];
  },

  intro() {
    const i = state.content.intro;
    return [
      h('p.intro', 'The text at the top of the page.'),
      text('Name', i, 'name'),
      area('Introduction', i, 'tagline', { rows: 4, hint: 'Shown under your name. Add a link with [link text](https://…).' }),
      area('About', i, 'bio', { rows: 10, hint: 'Shown on the right. Leave a blank line between paragraphs.' }),
    ];
  },

  highlights() {
    const hl = state.content.highlights;
    const list = hl.items;
    return [
      h('p.intro', 'The scrolling row of smaller projects near the bottom of the page.'),
      text('Section title', hl, 'title'),
      h('h3.group', 'Items'),
      h('div.list', list.map((it, i) => card(it, {
        thumb: it.icon, thumbIcon: true, title: it.title,
        canUp: i > 0, canDown: i < list.length - 1,
        onMove: (d) => move(list, i, i + d),
        onDuplicate: () => { const copy = clone(it); copy.title += ' (copy)'; list.splice(i + 1, 0, copy); state.open.add(copy); changed(); renderPanel(); },
        onDelete: () => { list.splice(i, 1); changed(); renderPanel(); },
        body: () => [
          text('Title', it, 'title'),
          text('Link', it, 'url', { type: 'url', placeholder: 'https://… (optional)' }),
          imageField('Logo / icon', it, 'icon', 'icon', { contain: true, hint: 'White on transparent works best. Shown 50px tall.', nameHint: () => it.title, onChange: renderPanel }),
          area('Description', it, 'text', { rows: 5 }),
          tagsField(it.tags),
        ],
      }))),
      h('button.btn.add', { type: 'button', onclick: () => { const it = { title: 'New highlight', url: '', icon: '', text: '', tags: [] }; list.push(it); state.open.add(it); changed(); renderPanel(); } }, '+ Add highlight'),
    ];
  },

  footer() {
    const f = state.content.footer;
    const draw = () => box.replaceChildren(...f.links.map((l, i) => h('div.card', h('div.card__body',
      h('div.grid2', text('Label', l, 'label'), text('Link', l, 'url', { placeholder: 'https://… or mailto:…' })),
      h('div.row',
        h('button.btn.btn--sm', { type: 'button', disabled: i === 0, onclick: () => { move(f.links, i, i - 1); } }, '↑ Up'),
        h('button.btn.btn--sm', { type: 'button', disabled: i === f.links.length - 1, onclick: () => { move(f.links, i, i + 1); } }, '↓ Down'),
        h('span.spacer'),
        h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => { f.links.splice(i, 1); changed(); renderPanel(); } }, 'Remove'))))));
    const box = h('div.list');
    draw();
    return [
      h('p.intro', 'The links at the bottom of the page.'),
      text('Section title', f, 'title'),
      h('h3.group', 'Links'),
      box,
      h('button.btn.add', { type: 'button', onclick: () => { f.links.push({ label: '', url: '' }); changed(); renderPanel(); } }, '+ Add link'),
    ];
  },

  settings() {
    const s = state.content.site;
    const host = () => { try { return new URL(s.url).host; } catch { return s.url || ''; } };
    const serp = h('div.serp');
    const social = h('div.social');
    const drawPreviews = () => {
      serp.replaceChildren(h('div.serp__url', host()), h('div.serp__title', s.title || 'Page title'), h('div.serp__desc', s.description || 'Description'));
      social.replaceChildren(
        h('div.social__img', { style: { backgroundImage: s.ogImage ? `url("${assetUrl(s.ogImage)}")` : '' } }),
        h('div.social__meta', h('div.social__host', host()), h('div.social__title', s.ogTitle || s.title || ''), h('div.social__desc', s.ogDescription || s.description || '')));
    };
    drawPreviews();
    const live = { onInput: drawPreviews };
    const ogNote = h('small.hint');
    return [
      h('h3.group', 'Search engines'),
      text('Page title', s, 'title', { limit: 60, ...live, hint: 'Shown in the browser tab and search results.' }),
      h('label', h('span', 'Description', h('span.count')), (() => {
        const ta = h('textarea', { rows: 3 }); ta.value = s.description || '';
        const count = () => { const c = ta.parentElement.querySelector('.count'); const n = ta.value.length; c.textContent = `${n} / 160`; c.classList.toggle('over', n > 160); };
        bind(s, 'description', ta, { onInput: () => { count(); drawPreviews(); } });
        queueMicrotask(count);
        return ta;
      })(), h('small', 'Shown under the title in search results and when shared.')),
      h('span.hint', 'Search result preview'),
      serp,

      h('h3.group', 'Social sharing (Open Graph)'),
      imageField('Share image', s, 'ogImage', 'og', {
        hint: 'Recommended 1200 × 630.', nameHint: () => 'og-image', onChange: drawPreviews,
        onSize: (w, hgt) => { ogNote.textContent = Math.abs(w / hgt - 1.905) > 0.1 ? `This image is ${w} × ${hgt}; some sites will crop it. 1200 × 630 fits best.` : ''; },
      }),
      ogNote,
      text('Share title', s, 'ogTitle', { placeholder: s.title, ...live, hint: 'Optional. Leave empty to use the page title.' }),
      text('Share description', s, 'ogDescription', { placeholder: 'Same as description', ...live, hint: 'Optional. Leave empty to use the description.' }),
      h('span.hint', 'Link preview'),
      social,

      h('h3.group', 'Icons'),
      imageField('Favicon', s, 'favicon', 'favicon', { contain: true, hint: 'Square PNG, at least 64 × 64.', nameHint: () => 'favicon' }),
      imageField('Home screen icon', s, 'appleTouchIcon', 'favicon', { contain: true, hint: 'Square PNG, 180 × 180.', nameHint: () => 'apple-touch-icon' }),

      h('h3.group', 'Site'),
      text('Site address', s, 'url', { type: 'url', ...live, hint: 'Used for the canonical link and share image URL.' }),
      text('Language', s, 'lang', { hint: 'e.g. en-GB' }),
    ];
  },
};

function renderPanel() {
  const panel = $('#panel');
  const scroll = panel.scrollTop;
  panel.replaceChildren(...[panels[state.tab]()].flat(Infinity).filter(Boolean));
  panel.scrollTop = scroll;
  $$('.tabs button').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === state.tab));
}

/* ---------- connection ---------- */
function updateConn() {
  const el = $('#conn');
  const { owner, repo, branch, token } = state.conn;
  el.classList.toggle('is-ok', !!token);
  el.textContent = token ? `${owner}/${repo} · ${branch}` : 'Not connected — click to connect';
}

function openConnect() {
  const f = $('#form-connect');
  for (const k of ['owner', 'repo', 'branch', 'token']) f.elements[k].value = state.conn[k] || '';
  $('#connect-msg').textContent = '';
  $('#dlg-connect').showModal();
}

$('#form-connect').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, msg = $('#connect-msg');
  const next = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim(), token: f.token.value.trim() };
  const prev = state.conn;
  state.conn = next;
  msg.className = 'msg'; msg.textContent = 'Checking…';
  try {
    const repo = await gh('');
    if (next.token && repo.permissions && !repo.permissions.push) throw new Error('This token can read the repository but cannot write to it. Give it Contents: Read and write.');
    await gh(`/branches/${encodeURIComponent(next.branch)}`);
    store.set('cms-conn', next);
    msg.className = 'msg ok'; msg.textContent = 'Connected.';
    $('#dlg-connect').close();
    updateConn();
    await load();
  } catch (err) {
    state.conn = prev;
    msg.className = 'msg err'; msg.textContent = err.message;
  }
});
$('#dlg-connect').addEventListener('click', (e) => {
  const act = e.target.dataset?.act;
  if (act === 'close') $('#dlg-connect').close();
  if (act === 'forget') {
    state.conn = { ...state.conn, token: '' };
    store.set('cms-conn', state.conn);
    $('#form-connect').token.value = '';
    updateConn();
    $('#connect-msg').className = 'msg'; $('#connect-msg').textContent = 'Token removed from this browser.';
  }
});
$('#conn').addEventListener('click', openConnect);

/* ---------- publish ---------- */
function summarise() {
  const a = state.published, b = state.content, out = [];
  const keyed = (list) => new Map(list.map((p) => [p.id || p.title, p]));
  const pa = keyed(a.projects || []), pb = keyed(b.projects || []);
  for (const [k, p] of pb) if (!pa.has(k)) out.push(`Added project “${p.title}”`);
  for (const [k, p] of pa) if (!pb.has(k)) out.push(`Removed project “${p.title}”`);
  for (const [k, p] of pb) if (pa.has(k) && JSON.stringify(pa.get(k)) !== JSON.stringify(p)) out.push(`Edited project “${p.title}”`);
  if (JSON.stringify((a.projects || []).map((p) => p.id)) !== JSON.stringify((b.projects || []).map((p) => p.id)) && !out.length) out.push('Reordered projects');
  if (JSON.stringify(a.intro) !== JSON.stringify(b.intro)) out.push('Edited intro');
  if (JSON.stringify(a.highlights) !== JSON.stringify(b.highlights)) out.push('Edited highlights');
  if (JSON.stringify(a.footer) !== JSON.stringify(b.footer)) out.push('Edited footer');
  if (JSON.stringify(a.site) !== JSON.stringify(b.site)) out.push('Updated settings & SEO');
  const imgs = referencedPaths(b).length;
  if (imgs) out.push(`${imgs} new image${imgs > 1 ? 's' : ''}`);
  return out;
}

$('#btn-publish').addEventListener('click', () => {
  if (!state.conn.token) { toast('Connect to GitHub first, so the CMS can publish for you.'); openConnect(); return; }
  const items = summarise();
  $('#publish-summary').replaceChildren(...(items.length ? items : ['Content changes']).map((t) => h('li', t)));
  const f = $('#form-publish');
  f.message.value = items.length === 1 ? items[0] : 'Update site content';
  $('#publish-msg').textContent = '';
  $('#dlg-publish').showModal();
});
$('#dlg-publish').addEventListener('click', (e) => { if (e.target.dataset?.act === 'close') $('#dlg-publish').close(); });

$('#form-publish').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#publish-msg');
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Publishing…';
  try {
    const sha = await publish(e.target.message.value.trim() || 'Update site content');
    $('#dlg-publish').close();
    const { owner, repo } = state.conn;
    toast(['Published. The live site updates in about a minute. ', h('a', { href: `https://github.com/${owner}/${repo}/commit/${sha}`, target: '_blank', rel: 'noopener' }, 'View change')], 9000);
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = `Couldn't publish: ${err.message}`;
  } finally { btn.disabled = false; }
});

async function publish(message) {
  const { branch } = state.conn;
  const content = clone(state.content);
  const ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
  const head = ref.object.sha;
  const commit = await gh(`/git/commits/${head}`);

  // Someone else changed the content since we loaded it?
  if (state.publishedSha) {
    try {
      const current = await gh(`/contents/content.json?ref=${head}`);
      if (current.sha !== state.publishedSha &&
        !confirm('The site content was changed elsewhere since you loaded this editor. Publishing will replace those changes with yours. Continue?')) {
        throw new Error('Cancelled. Use More → Reload from GitHub to start from the latest version.');
      }
    } catch (err) { if (err.status !== 404) throw err; }
  }

  const tree = [];
  for (const path of referencedPaths(content)) {
    const bytes = new Uint8Array(await state.pending.get(path).blob.arrayBuffer());
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: bytesToB64(bytes), encoding: 'base64' }) });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const json = JSON.stringify(content, null, 2) + '\n';
  tree.push({ path: 'content.json', mode: '100644', type: 'blob', content: json });
  tree.push({ path: 'index.html', mode: '100644', type: 'blob', content: renderSite(content) });

  const newTree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree }) });
  const newCommit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }) });
  await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });

  // Success: the published state is now what we just sent.
  const after = await gh(`/contents/content.json?ref=${newCommit.sha}`).catch(() => null);
  state.published = content;
  state.publishedSha = after?.sha || null;
  store.del('cms-draft');
  await idb.clear();
  // Keep blob URLs for images still on screen; they are now on GitHub too.
  changed({ save: false });
  return newCommit.sha;
}

/* ---------- menu & misc ---------- */
const menu = $('#menu');
$('#btn-more').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
document.addEventListener('click', () => { menu.hidden = true; });
menu.addEventListener('click', async (e) => {
  const act = e.target.dataset?.act;
  if (!act) return;
  if (act === 'connect') openConnect();
  if (act === 'reload') {
    if (isDirty() && !confirm('Reloading will discard your unpublished changes. Continue?')) return;
    store.del('cms-draft'); await idb.clear(); state.pending.clear(); state.open.clear();
    await load({ keepDraft: false });
    toast('Loaded the latest published content.');
  }
  if (act === 'discard') {
    if (!isDirty()) { toast('There are no unpublished changes.'); return; }
    if (!confirm('Discard all unpublished changes?')) return;
    state.content = clone(state.published); normalise(state.content);
    store.del('cms-draft'); await idb.clear(); state.pending.clear(); state.open.clear();
    renderPanel(); changed({ save: false });
    toast('Changes discarded.');
  }
  if (act === 'download') {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(state.content, null, 2) + '\n'], { type: 'application/json' })), download: 'content.json' });
    a.click();
  }
});

$$('.tabs button').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; store.set('cms-tab', state.tab); $('#panel').scrollTop = 0; renderPanel(); }));
$$('.bar__mid .seg').forEach((b) => b.addEventListener('click', () => {
  $('.layout').dataset.view = b.dataset.view;
  $$('.bar__mid .seg').forEach((x) => x.classList.toggle('is-on', x === b));
}));
// Render the preview at the real device width and scale it down to fit.
const DEVICE_WIDTH = { desktop: 1440, tablet: 810, mobile: 390 };
function fitPreview() {
  const stage = $('.preview__stage'), frame = $('#preview');
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const w = DEVICE_WIDTH[state.device] || 1440;
  const pad = state.device === 'desktop' ? 0 : 32;
  const scale = Math.min(1, (W - pad) / w);
  frame.style.width = `${w}px`;
  frame.style.height = `${(H - pad) / scale}px`;
  frame.style.transform = `translateX(-50%) scale(${scale})`;
}
new ResizeObserver(fitPreview).observe($('.preview__stage'));
const setDevice = (d) => {
  state.device = d; store.set('cms-device', d);
  $('.layout').dataset.device = d;
  $$('.devices button').forEach((x) => x.classList.toggle('is-on', x.dataset.device === d));
  fitPreview();
};
$$('.devices button').forEach((b) => b.addEventListener('click', () => setDevice(b.dataset.device)));
setDevice(state.device);

load().catch((e) => { $('#panel').replaceChildren(h('p.msg.err', `Couldn't start the editor: ${e.message}`)); });
