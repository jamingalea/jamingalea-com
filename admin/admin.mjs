// Portfolio CMS — edits content.json, previews it live, and publishes
// content.json + a regenerated index.html (+ any new images) to GitHub
// in a single commit. Vercel redeploys on push.
import { renderSite, renderCaseStudy, renderPages, migrate, isLive, caseStudyProblem, caseStudyTitle, projectOf } from '/render.mjs';
import { richText } from '/admin/editor.mjs';

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
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val;
      }
    }
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
// Older versions kept a GitHub token in the browser. It now lives in Vercel's settings, so forget it here.
store.del('cms-conn');

const state = {
  conn: null,             // { owner, repo, branch } from the server once signed in
  published: null,        // content as last loaded from GitHub / the site
  publishedSha: null,     // blob sha of content.json we based our edits on
  content: null,          // working copy
  pending: new Map(),     // path -> { blob, url }
  tab: store.get('cms-tab', 'projects'),
  open: new Set(),        // expanded cards (object refs)
  caseFor: null,          // case study being edited (Case studies tab)
  previewPage: 'home',    // 'home' or a case study id
  device: store.get('cms-device', 'desktop'),
};

/* ---------- GitHub, via the site's password-protected API (middleware.js) ---------- */
async function api(path, opts = {}) {
  const res = await fetch(`/admin/api${path}`, {
    ...opts,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'X-CMS': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) {
    // Session expired: the next page load shows the sign-in screen.
    toast('You’ve been signed out. Your draft is saved — sign in again to continue.', 8000);
    setTimeout(() => location.reload(), 2500);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
    const hint = res.status === 502 ? '' // message from the server already explains it
      : res.status === 403 ? 'The GITHUB_TOKEN in Vercel lacks permission (needs Contents: Read and write).'
      : res.status === 404 ? 'Repository or branch not found. Check CMS_REPO / CMS_BRANCH in Vercel.'
      : res.status === 409 || res.status === 422 ? 'GitHub rejected the update.' : '';
    const err = new Error(`${hint} ${detail ? (hint ? `(${detail})` : detail) : `(HTTP ${res.status})`}`.trim());
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}
const gh = (path, opts) => api(`/github${path}`, opts);

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
  if (!state.conn) {
    try { state.conn = await api('/config'); } catch { state.conn = null; }
  }
  try {
    base = state.conn ? await loadFromGitHub() : await loadFromSite();
  } catch (e) {
    toast(`Couldn't load from GitHub: ${e.message} Showing the site's current content instead.`, 7000);
    base = await loadFromSite();
  }
  state.published = migrate(base.content); // older content kept case studies inside projects
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
  migrate(c);
  c.highlights ||= { title: 'Other highlights', items: [] }; c.highlights.items ||= [];
  c.footer ||= { title: 'More information', links: [] }; c.footer.links ||= [];
  for (const p of c.projects) { p.tags ||= []; p.column ||= 'left'; p.id ||= uniqueId(p.title, p); }
  for (const i of c.highlights.items) i.tags ||= [];
  for (const cs of c.caseStudies) { cs.meta ||= []; cs.blocks ||= []; cs.id ||= uniqueSlug(caseStudyTitle(c, cs), cs); }
}

function uniqueSlug(title, self) {
  const base = slugify(title);
  const taken = new Set((state.content?.caseStudies || []).filter((x) => x !== self).map((x) => x.id));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
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
  const opts = { asset: assetUrl, headExtra: PREVIEW_HEAD, preview: true };
  const cs = state.previewPage !== 'home' && state.content.caseStudies.find((x) => x.id === state.previewPage);
  frame.srcdoc = cs ? renderCaseStudy(state.content, cs, opts) : renderSite(state.content, opts);
  updatePageSelect();
}

// The preview's page picker lists the homepage and every case study.
function updatePageSelect() {
  const sel = $('#preview-page');
  const c = state.content, list = c.caseStudies;
  if (state.previewPage !== 'home' && !list.some((x) => x.id === state.previewPage)) state.previewPage = 'home';
  sel.replaceChildren(h('option', { value: 'home' }, 'Homepage'),
    ...list.map((x) => h('option', { value: x.id }, `Case study: ${caseStudyTitle(c, x)}${isLive(c, x) ? (x.unlisted ? ' (unlisted)' : '') : ' (draft)'}`)));
  sel.value = state.previewPage;
  sel.hidden = !list.length;
}
function showPreviewPage(page) {
  if (state.previewPage === page) return;
  state.previewPage = page;
  const frame = $('#preview');
  try { frame.contentWindow.scrollTo(0, 0); } catch { /* ignore */ }
  renderPreview();
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

/* ---------- empty image placeholder ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
function imageIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'img-icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of [
    ['rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 2.5 }],
    ['circle', { cx: 8.75, cy: 9.75, r: 1.75 }],
    ['path', { d: 'M3.5 17.5l5-5 4 4 2.5-2.5 5.5 5.5' }],
  ]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
const imagePlaceholder = (cls) => h(`div.${cls}.img-empty`, { title: 'No image yet' }, imageIcon());

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

// Long text: a formatting editor (bold, italic, links), or a plain box for
// text with a length limit such as search descriptions.
function area(label, obj, key, opts = {}) {
  if (!opts.plain && !opts.limit) {
    const editor = richText({
      value: obj[key] ?? '',
      label,
      placeholder: opts.placeholder,
      rows: opts.rows,
      notify: (m) => toast(m),
      onChange: (text) => { obj[key] = text; opts.onInput?.(text); changed(); },
    });
    return h('div.field', h('span.field__label', label), editor,
      h('small', opts.hint ?? 'Enter starts a new paragraph. Shift+Enter adds a line break.'));
  }
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
    pv.replaceChildren(...(v ? [] : [imageIcon()]));
    pv.title = v ? '' : 'No image yet';
    path.textContent = v ? (state.pending.has(v) ? 'New image (publish to upload)' : v) : '';
    removeBtn.hidden = !v || opts.required;
    if (opts.focusKey) {
      const f = obj[opts.focusKey];
      pv.style.backgroundPosition = f ? `${f.x}% ${f.y}%` : '';
      cropBtn.hidden = !v;
      cropNote.textContent = v ? (f ? `Focal point set (${Math.round(f.x)}% across, ${Math.round(f.y)}% down)` : 'Cropped around the centre') : '';
    }
  };
  const cropBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => openFocusDialog(obj, opts.focusKey, assetUrl(obj[key]), upd) }, 'Adjust crop…');
  const cropNote = h('span.hint');
  const take = async (f) => {
    if (!f) return;
    try {
      const { path: p, w, h: hgt } = await addImage(f, kind, opts.nameHint?.() || label);
      obj[key] = p;
      if (opts.focusKey) delete obj[opts.focusKey];
      if (opts.onSize && w) opts.onSize(w, hgt);
      upd(); changed(); opts.onChange?.();
    } catch (e) { toast(e.message || String(e)); }
  };
  file.addEventListener('change', () => { take(file.files[0]); file.value = ''; });
  removeBtn.addEventListener('click', () => { obj[key] = ''; if (opts.focusKey) delete obj[opts.focusKey]; upd(); changed(); opts.onChange?.(); });
  const wrap = h('div.imgfield', pv, h('div.imgfield__side',
    h('span.imgfield__label', label),
    opts.hint && h('span.hint', opts.hint),
    h('div.row', h('button.btn.btn--sm', { type: 'button', onclick: () => file.click() }, 'Upload…'), opts.focusKey && cropBtn, removeBtn),
    opts.focusKey && cropNote, path, file));
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drop'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
  wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('drop'); take(e.dataTransfer.files[0]); });
  upd();
  return wrap;
}

// "Adjust crop…" dialog: click or drag on the full image to choose the spot that must
// stay visible when the site crops it. Stored as obj[key] = { x, y } in percent;
// centre is the default and isn't stored. Changes apply (and preview) as you drag.
const CROPS = [['Landscape', '1896 / 1456'], ['Square', '1 / 1'], ['Tall', '3 / 4'], ['Wide', '16 / 7']];
function openFocusDialog(obj, key, url, onChange) {
  const before = obj[key] ? { ...obj[key] } : null;
  const img = h('img', { alt: '', draggable: 'false', src: url });
  const dot = h('span.focus__dot');
  const stage = h('div.focus__stage', { tabindex: 0, role: 'slider', 'aria-label': 'Focal point. Use the arrow keys to move it.' }, img, dot);
  const crops = CROPS.map(([label, ratio]) => {
    const box = h('div.focus__crop', { style: { aspectRatio: ratio, backgroundImage: `url("${url}")` } });
    return { box, el: h('figure.focus__cropfig', box, h('figcaption', label)) };
  });
  const coords = h('span.hint');
  const reset = h('button.btn.btn--ghost', { type: 'button' }, 'Reset to centre');
  const cancel = h('button.btn.btn--ghost', { type: 'button' }, 'Cancel');
  const done = h('button.btn.btn--primary', { type: 'button' }, 'Done');
  const dlg = h('dialog.dlg.focus-dlg', { 'aria-label': 'Adjust crop' },
    h('div.focus__head', h('h2', 'Focal point'), coords),
    h('p.hint', 'Click or drag on the image to mark what must stay in view. When the site crops the image to fit a screen, it crops around this point.'),
    h('div.focus__body', stage, h('div.focus__crops', crops.map((c) => c.el))),
    h('div.dlg__actions', reset, h('span.spacer'), cancel, done));
  const get = () => {
    const f = obj[key];
    return f && typeof f === 'object' ? { x: +f.x, y: +f.y } : { x: 50, y: 50 };
  };
  const draw = () => {
    const { x, y } = get();
    dot.style.left = `${x}%`; dot.style.top = `${y}%`;
    for (const c of crops) c.box.style.backgroundPosition = `${x}% ${y}%`;
    coords.textContent = x === 50 && y === 50 ? 'Centre' : `${Math.round(x)}% across, ${Math.round(y)}% down`;
    stage.setAttribute('aria-valuetext', coords.textContent);
    reset.disabled = x === 50 && y === 50;
  };
  const write = (f) => { if (f) obj[key] = f; else delete obj[key]; draw(); changed(); onChange?.(); };
  const set = (x, y) => {
    const r = (v) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
    x = r(x); y = r(y);
    write(x === 50 && y === 50 ? null : { x, y });
  };
  const fromEvent = (e) => {
    const b = img.getBoundingClientRect();
    set(((e.clientX - b.left) / b.width) * 100, ((e.clientY - b.top) / b.height) * 100);
  };
  stage.addEventListener('pointerdown', (e) => { e.preventDefault(); stage.focus(); stage.setPointerCapture(e.pointerId); stage.classList.add('is-dragging'); fromEvent(e); });
  stage.addEventListener('pointermove', (e) => { if (stage.hasPointerCapture(e.pointerId)) fromEvent(e); });
  const end = () => stage.classList.remove('is-dragging');
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 2, { x, y } = get();
    set(x + d[0] * step, y + d[1] * step);
  });
  reset.addEventListener('click', () => set(50, 50));
  cancel.addEventListener('click', () => { write(before); dlg.close(); });
  done.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  draw();
  dlg.showModal();
  stage.focus();
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
function card(item, { thumb, thumbIcon, noThumb, kind, title, subtitle, onMove, canUp, canDown, onDuplicate, onDelete, body, scrollId }) {
  const isOpen = state.open.has(item);
  const head = h('div.card__head', { role: 'button', tabindex: 0, 'aria-expanded': String(isOpen) },
    !noThumb && (thumb
      ? h('img.card__thumb' + (thumbIcon ? '.card__thumb--icon' : ''), { src: assetUrl(thumb), alt: '' })
      : imagePlaceholder('card__thumb')),
    kind && h('span.kind', kind),
    h('div.card__title', title || (kind ? '' : 'Untitled'), item.hidden && h('span.badge', 'Hidden'), subtitle && h('span.muted', subtitle)),
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

/* ---------- case studies ---------- */
const BLOCK_TYPES = {
  text: { label: 'Text', make: () => ({ type: 'text', heading: '', text: '' }) },
  image: { label: 'Image', make: () => ({ type: 'image', image: '', alt: '', caption: '', size: 'full' }) },
  gallery: { label: 'Image row', make: () => ({ type: 'gallery', images: [{ image: '', alt: '', caption: '' }, { image: '', alt: '', caption: '' }] }) },
  quote: { label: 'Quote', make: () => ({ type: 'quote', text: '', cite: '' }) },
  stats: { label: 'Numbers', make: () => ({ type: 'stats', heading: '', items: [{ value: '', label: '' }, { value: '', label: '' }, { value: '', label: '' }] }) },
};

function newCaseStudy(projectId = '') {
  return {
    id: '', title: '', project: projectId, enabled: false, unlisted: false,
    summary: '', heroImage: '', heroAlt: '',
    meta: [{ label: 'Role', value: '' }, { label: 'Year', value: '' }],
    blocks: [
      { type: 'text', heading: 'The challenge', text: '' },
      { type: 'text', heading: 'The approach', text: '' },
      { type: 'text', heading: 'The outcome', text: '' },
    ],
  };
}

function createCaseStudy(projectId = '') {
  const c = state.content;
  const cs = newCaseStudy(projectId);
  cs.id = uniqueSlug(projectId ? caseStudyTitle(c, cs) : 'new-case-study', cs);
  c.caseStudies.push(cs);
  openCaseStudy(cs);
}

function openCaseStudy(cs) {
  state.caseFor = cs;
  state.tab = 'caseStudies'; store.set('cms-tab', state.tab);
  $('#panel').scrollTop = 0;
  changed(); renderPanel();
  showPreviewPage(cs.id);
}

// Short status for lists: [label, tone].
function caseStudyStatus(cs) {
  const c = state.content;
  switch (caseStudyProblem(c, cs)) {
    case 'draft': return ['Draft', ''];
    case 'no-project': return ['Needs a project', 'warn'];
    case 'project-hidden': return ['Project is hidden', 'warn'];
    case 'no-title': return ['Needs a title', 'warn'];
    case 'no-address': return ['Needs a page address', 'warn'];
    default: return cs.unlisted ? ['Live · unlisted', 'ok'] : ['Live', 'ok'];
  }
}
const statusBadge = (cs) => { const [label, tone] = caseStudyStatus(cs); return h(`span.status${tone ? '.status--' + tone : ''}`, label); };

// On a project card: one line linking to its case study.
function caseStudyEntry(p) {
  const cs = state.content.caseStudies.find((x) => x.project === p.id);
  return h('div.cs-entry',
    h('div', h('strong', 'Case study'), cs ? statusBadge(cs) : h('span.hint', 'None yet')),
    cs
      ? h('button.btn.btn--sm', { type: 'button', onclick: () => openCaseStudy(cs) }, 'Edit →')
      : h('button.btn.btn--sm', { type: 'button', onclick: () => createCaseStudy(p.id) }, 'Create →'));
}

function blockBody(b) {
  switch (b.type) {
    case 'text': return [
      text('Heading', b, 'heading', { placeholder: 'Optional, e.g. The challenge' }),
      area('Text', b, 'text', { rows: 8 }),
    ];
    case 'image': return [
      imageField('Image', b, 'image', 'project', { onChange: renderPanel, nameHint: () => state.caseFor?.title }),
      text('Image description (alt text)', b, 'alt'),
      text('Caption', b, 'caption', { placeholder: 'Optional' }),
      select('Size', b, 'size', [['full', 'Full width'], ['inset', 'Narrower']]),
    ];
    case 'gallery': return [
      h('p.hint', 'Two or three images side by side. On phones they stack.'),
      ...b.images.map((img, i) => h('div.subcard',
        imageField(`Image ${i + 1}`, img, 'image', 'project', { onChange: renderPanel, nameHint: () => state.caseFor?.title }),
        text('Alt text', img, 'alt'),
        text('Caption', img, 'caption', { placeholder: 'Optional' }),
        b.images.length > 1 && h('button.btn.btn--sm.btn--danger', { type: 'button', style: { marginBottom: '16px' }, onclick: () => { b.images.splice(i, 1); changed(); renderPanel(); } }, 'Remove image'))),
      b.images.length < 3 && h('button.btn.btn--sm', { type: 'button', style: { marginBottom: '24px' }, onclick: () => { b.images.push({ image: '', alt: '', caption: '' }); changed(); renderPanel(); } }, '+ Add image'),
    ];
    case 'quote': return [
      area('Quote', b, 'text', { rows: 4, hint: '' }),
      text('Who said it', b, 'cite', { placeholder: 'e.g. Jane Smith, Head of Product' }),
    ];
    case 'stats': return [
      text('Heading', b, 'heading', { placeholder: 'Optional, e.g. Results' }),
      ...b.items.map((s, i) => h('div.subcard',
        h('div.grid2', text('Number', s, 'value', { placeholder: 'e.g. 12%' }), text('Label', s, 'label', { placeholder: 'e.g. of revenue' })),
        h('button.btn.btn--sm.btn--danger', { type: 'button', style: { marginBottom: '16px' }, onclick: () => { b.items.splice(i, 1); changed(); renderPanel(); } }, 'Remove'))),
      h('button.btn.btn--sm', { type: 'button', style: { marginBottom: '24px' }, onclick: () => { b.items.push({ value: '', label: '' }); changed(); renderPanel(); } }, '+ Add number'),
    ];
    default: return [h('p.hint', `Unknown block type “${b.type}”.`)];
  }
}

function blockTitle(b) {
  const first = (s) => String(s || '').split('\n')[0].slice(0, 60);
  return first(b.heading) || first(b.text) || first(b.caption) || (b.image && 'Image') || '';
}

function caseStudyPanel(cs) {
  const c = state.content;
  const p = projectOf(c, cs);
  const blocks = cs.blocks;
  const metaBox = h('div');
  const drawMeta = () => metaBox.replaceChildren(...cs.meta.map((m, i) => h('div.subcard',
    h('div.grid2', text('Label', m, 'label', { placeholder: 'e.g. Role' }), text('Value', m, 'value', { placeholder: 'e.g. Lead Product Designer' })),
    h('div.row', { style: { marginBottom: '16px' } },
      h('button.btn.btn--sm', { type: 'button', disabled: i === 0, onclick: () => { cs.meta.splice(i - 1, 0, cs.meta.splice(i, 1)[0]); changed(); drawMeta(); } }, '↑ Up'),
      h('span.spacer'),
      h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => { cs.meta.splice(i, 1); changed(); drawMeta(); } }, 'Remove')))),
  h('button.btn.btn--sm', { type: 'button', onclick: () => { cs.meta.push({ label: '', value: '' }); changed(); drawMeta(); } }, '+ Add detail'));
  drawMeta();

  const addBlock = (type) => { const b = BLOCK_TYPES[type].make(); blocks.push(b); state.open.add(b); changed(); renderPanel(); };
  const slug = h('input', { type: 'text', value: cs.id });
  // Until it has been published, the address follows the title unless edited by hand.
  const wasPublished = (state.published.caseStudies || []).some((x) => x.id === cs.id);
  let autoSlug = !wasPublished && (cs.id === uniqueSlug(caseStudyTitle(c, cs), cs) || /^new-case-study(-\d+)?$/.test(cs.id));
  slug.addEventListener('input', () => { autoSlug = false; });
  slug.addEventListener('change', () => {
    const next = uniqueSlug(slug.value || caseStudyTitle(c, cs), cs);
    if (state.previewPage === cs.id) state.previewPage = next;
    cs.id = next; slug.value = next; changed(); renderPanel();
  });

  // Project picker: each project can have one case study.
  const projSel = h('select',
    h('option', { value: '' }, '— No project —'),
    c.projects.map((x) => {
      const other = c.caseStudies.find((o) => o !== cs && o.project === x.id);
      return h('option', { value: x.id, disabled: !!other }, `${x.title || 'Untitled'}${x.hidden ? ' (hidden)' : ''}${other ? ' — has a case study' : ''}`);
    }));
  projSel.value = cs.project || '';
  projSel.addEventListener('change', () => { cs.project = projSel.value; changed(); renderPanel(); });

  const problem = caseStudyProblem(c, cs);
  const where = `/work/${cs.id}/`;
  const publishHint = {
    draft: 'Off: you can write and preview it, but it stays off the site until you switch this on.',
    'no-project': 'Choose a project above, or turn on “Unlisted”, before this can go on the site.',
    'project-hidden': 'Its project is hidden on the homepage, so this stays off the site. Show the project or turn on “Unlisted”.',
    'no-title': 'Give it a title above before it can go on the site.',
    'no-address': 'Give it a page address below before it can go on the site.',
  }[problem] || (cs.unlisted
    ? `When you publish, the page goes live at ${where}. Nothing on the site links to it, and search engines are asked not to list it.`
    : `When you publish, the page goes live at ${where} and “${p?.title}” on the homepage links to it.`);

  return [
    h('button.back', { type: 'button', onclick: () => { state.caseFor = null; renderPanel(); showPreviewPage('home'); } }, '← All case studies'),
    h('div.row', { style: { marginBottom: '8px' } }, h('h2.cs-title', { style: { margin: 0 } }, caseStudyTitle(c, cs)), statusBadge(cs)),
    h('p.intro', 'A page with more detail about a project. Wherever you leave a field empty, the project’s homepage text and image are used.'),

    h('h3.group', 'Page'),
    h('label', 'Project', projSel, h('small', 'The homepage project this case study belongs to. Its title, image, tags and link fill in anything left empty here.')),
    text('Title', cs, 'title', { placeholder: p?.title || 'e.g. Redesigning checkout', hint: p ? 'Leave empty to use the project title.' : '', onInput: () => {
      $('.cs-title').textContent = caseStudyTitle(c, cs);
      if (!autoSlug) return;
      const next = uniqueSlug(caseStudyTitle(c, cs), cs);
      if (state.previewPage === cs.id) state.previewPage = next;
      cs.id = next; slug.value = next;
    } }),
    h('label', 'Page address', h('div.row', h('span.muted', '/work/'), slug, h('span.muted', '/')), h('small', 'Letters, numbers and dashes. Changing it changes the link.')),

    h('div.toggles',
      h('label.check', bind(cs, 'enabled', h('input', { type: 'checkbox', checked: !!cs.enabled }), { onInput: () => renderPanel() }), 'Publish this case study'),
      h('label.check', bind(cs, 'unlisted', h('input', { type: 'checkbox', checked: !!cs.unlisted }), { onInput: () => renderPanel() }),
        'Unlisted', h('span.hint', '— only people with the link can find it')),
      h('p.hint' + (problem && problem !== 'draft' ? '.warn' : ''), publishHint)),

    h('h3.group', 'Introduction'),
    area('Summary', cs, 'summary', { rows: 5, placeholder: p ? 'Leave empty to use the homepage description.' : '' }),
    imageField('Main image', cs, 'heroImage', 'project', { hint: p ? 'Leave empty to use the homepage image.' : '', onChange: renderPanel, nameHint: () => caseStudyTitle(c, cs) }),
    text('Main image description (alt text)', cs, 'heroAlt'),

    h('h3.group', 'Project details'),
    h('p.hint', 'Shown beside the summary, e.g. Role, Year, Team, Platform. The project’s link is added automatically.'),
    metaBox,

    h('h3.group', 'Content'),
    h('p.hint', 'The body of the page, built from blocks. Reorder with the arrows.'),
    h('div.list', blocks.map((b, i) => card(b, {
      noThumb: true, kind: BLOCK_TYPES[b.type]?.label || b.type, title: blockTitle(b),
      canUp: i > 0, canDown: i < blocks.length - 1,
      onMove: (d) => move(blocks, i, i + d),
      onDuplicate: () => { const copy = clone(b); blocks.splice(i + 1, 0, copy); state.open.add(copy); changed(); renderPanel(); },
      onDelete: () => { blocks.splice(i, 1); changed(); renderPanel(); },
      body: () => blockBody(b),
    }))),
    h('div.add-row', h('span.hint', { style: { alignSelf: 'center', marginRight: '4px' } }, 'Add:'),
      Object.entries(BLOCK_TYPES).map(([type, t]) => h('button.btn.btn--sm', { type: 'button', onclick: () => addBlock(type) }, `+ ${t.label}`))),

    h('h3.group', 'Search & sharing'),
    text('Page title', cs, 'seoTitle', { placeholder: `${caseStudyTitle(c, cs)} — ${c.intro?.name || ''}`, limit: 60 }),
    area('Description', cs, 'seoDescription', { rows: 3, limit: 160, hint: 'Leave empty to use the summary.' }),
    imageField('Share image', cs, 'ogImage', 'og', { hint: 'Leave empty to use the main image. 1200 × 630 fits best.', nameHint: () => `${caseStudyTitle(c, cs)} og` }),

    h('h3.group', 'Danger zone'),
    h('div.row', { style: { marginBottom: '32px' } },
      h('button.btn.btn--sm', { type: 'button', onclick: () => {
        const copy = clone(cs); copy.title = `${caseStudyTitle(c, cs)} (copy)`; copy.project = ''; copy.enabled = false;
        copy.id = uniqueSlug(copy.title, copy);
        c.caseStudies.splice(c.caseStudies.indexOf(cs) + 1, 0, copy); openCaseStudy(copy);
      } }, 'Duplicate'),
      h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => {
        if (!confirm(`Delete the case study “${caseStudyTitle(c, cs)}”? You can still discard this before publishing.`)) return;
        c.caseStudies.splice(c.caseStudies.indexOf(cs), 1);
        state.caseFor = null; changed(); renderPanel(); showPreviewPage('home');
      } }, 'Delete case study')),
  ];
}

/* ---------- analytics ---------- */
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
state.analyticsDays = store.get('cms-analytics-days', 30);
state.analyticsCache = {};

const fmt = (n) => Number(n || 0).toLocaleString('en-GB');
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en-GB'], { type: 'region' }); } catch { /* old browser */ }
const flag = (code) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
const countryName = (code) => {
  if (!code) return 'Unknown';
  try { return regionNames?.of(code) || code; } catch { return code; }
};

function analyticsHelp(st, message) {
  const steps = {
    'not-enabled': [
      'Analytics isn’t switched on yet',
      'In Vercel, open your project, go to the Analytics tab and click Enable. Visits are counted from then on, so the numbers start at zero.',
    ],
    'no-token': [
      'One more setting needed',
      'Create a token at vercel.com → Account Settings → Tokens (scope: your projects, expiry: your choice). Then add it in your project → Settings → Environment Variables as ANALYTICS_TOKEN (tick Sensitive), and redeploy.',
    ],
    'bad-token': [
      'Vercel didn’t accept the analytics token',
      'The ANALYTICS_TOKEN in your Vercel settings may have expired. Create a new token and replace it, then redeploy.',
    ],
    error: ['Couldn’t load analytics', message || 'Something went wrong talking to Vercel. Try again in a minute.'],
    offline: ['Analytics works on the live site', 'Open the CMS at your site’s /admin page to see your numbers.'],
  }[st] || ['Couldn’t load analytics', message || ''];
  return h('div.notice', h('strong', steps[0]), h('p', steps[1]));
}

function statTile(label, value, sub) {
  return h('div.stat', h('span.stat__label', label), h('span.stat__value', value), sub && h('span.stat__sub', sub));
}

// One bar per day; hover or focus a bar for its numbers.
function dailyChart(data) {
  const byDay = new Map(data.daily.map((d) => [d.day, d]));
  const days = [];
  const start = new Date(`${data.since.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${data.until.slice(0, 10)}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 864e5) {
    const key = new Date(t).toISOString().slice(0, 10);
    days.push(byDay.get(key) || { day: key, visitors: 0, pageviews: 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const label = (key, opts) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
  const tip = h('div.chart__tip', { role: 'status' });
  tip.hidden = true;
  const show = (bar, d) => {
    tip.replaceChildren(h('strong', label(d.day, { weekday: 'short', day: 'numeric', month: 'short' })),
      h('span', `${fmt(d.visitors)} visitor${d.visitors === 1 ? '' : 's'}`), h('span', `${fmt(d.pageviews)} page view${d.pageviews === 1 ? '' : 's'}`));
    tip.hidden = false;
    const plot = bar.parentElement.getBoundingClientRect(), r = bar.getBoundingClientRect();
    const x = r.left - plot.left + r.width / 2;
    tip.style.left = `${Math.min(Math.max(x, 70), plot.width - 70)}px`;
    tip.style.top = `${Math.max(r.top - plot.top + bar.firstChild.offsetTop - 8, 0)}px`;
    bars.forEach((b) => b.classList.toggle('is-hover', b === bar));
  };
  const hide = () => { tip.hidden = true; bars.forEach((b) => b.classList.remove('is-hover')); };
  const bars = days.map((d) => {
    const bar = h('button.chart__bar', {
      type: 'button',
      'aria-label': `${label(d.day, { day: 'numeric', month: 'long' })}: ${d.visitors} visitors, ${d.pageviews} page views`,
      style: { '--h': `${(d.visitors / max) * 100}%` },
    }, h('span'));
    bar.addEventListener('mouseenter', () => show(bar, d));
    bar.addEventListener('focus', () => show(bar, d));
    bar.addEventListener('blur', hide);
    return bar;
  });
  const plot = h('div.chart__plot', bars, tip);
  plot.addEventListener('mouseleave', hide);
  return h('figure.chart',
    h('div.chart__max', `${fmt(max)}`),
    plot,
    h('figcaption.chart__axis', h('span', label(days[0].day, { day: 'numeric', month: 'short' })), h('span', label(days[days.length - 1].day, { day: 'numeric', month: 'short' }))));
}

function rankList(items, empty) {
  if (!items.length) return h('p.hint', empty);
  const max = Math.max(1, ...items.map((i) => i.value));
  return h('ol.rank', items.map((i) => h('li',
    h('span.rank__name', i.name),
    h('span.rank__value', fmt(i.value)),
    h('span.rank__bar', { style: { '--w': `${(i.value / max) * 100}%` } }))));
}

function analyticsView(data) {
  const { totals } = data;
  const perVisitor = totals.visitors ? (totals.pageviews / totals.visitors).toFixed(1) : '0';
  const siteHosts = new Set([location.hostname, 'jamingalea.com', 'www.jamingalea.com']);
  try { siteHosts.add(new URL(state.content.site.url).hostname); } catch { /* ignore */ }

  const countries = data.countries.map((c) => ({ name: `${flag(c.key)} ${countryName(c.key)}`.trim(), value: c.visitors || c.pageviews }));
  const sourceTotals = new Map();
  for (const s of data.sources) {
    const host = String(s.key || '').replace(/^www\./, '');
    if (siteHosts.has(host) || siteHosts.has(`www.${host}`)) continue;
    const name = host || 'Direct (typed or bookmarked)';
    sourceTotals.set(name, (sourceTotals.get(name) || 0) + (s.visitors || s.pageviews));
  }
  const sources = [...sourceTotals].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Case studies: live ones are always listed, even with no views yet; pages that
  // were viewed but have since been removed or renamed show their address.
  const c = state.published || state.content;
  const viewsById = new Map();
  for (const p of data.pages) {
    const m = /^\/work\/([^/]+)/.exec(p.key || '');
    if (m) viewsById.set(m[1], (viewsById.get(m[1]) || 0) + p.pageviews);
  }
  const known = new Map((c.caseStudies || []).map((cs) => [cs.id, cs]));
  const studies = [
    ...(c.caseStudies || []).filter((cs) => isLive(c, cs) || viewsById.has(cs.id)).map((cs) => ({
      name: `${caseStudyTitle(c, cs)}${cs.unlisted ? ' (unlisted)' : ''}`, value: viewsById.get(cs.id) || 0,
    })),
    ...[...viewsById].filter(([id]) => !known.has(id)).map(([id, value]) => ({ name: `/work/${id}/`, value })),
  ].sort((a, b) => b.value - a.value);
  const homeViews = data.pages.filter((p) => p.key === '/' || p.key === '/index.html').reduce((n, p) => n + p.pageviews, 0);

  return [
    h('div.stats',
      statTile('Visitors', fmt(totals.visitors), 'unique people'),
      statTile('Page views', fmt(totals.pageviews), `${fmt(homeViews)} on the homepage`),
      statTile('Pages per visitor', perVisitor)),
    h('h3.group', 'Visitors per day'),
    totals.pageviews ? dailyChart(data) : h('p.hint', 'No visits recorded in this period yet.'),
    h('h3.group', 'Where visitors are from'),
    rankList(countries, 'No data yet.'),
    h('h3.group', 'How they found your site'),
    rankList(sources, 'No data yet.'),
    h('h3.group', 'Case studies viewed'),
    rankList(studies, 'No case studies are published yet. Their views will appear here once they are.'),
    h('p.hint', { style: { marginTop: '28px' } }, 'Counted by Vercel Web Analytics, without cookies. Your own visits to the CMS aren’t counted. Numbers can take a few minutes to appear.'),
  ];
}

function analyticsPanel() {
  const body = h('div.analytics');
  const days = state.analyticsDays;
  const ranges = h('div.devices.range', { role: 'group', 'aria-label': 'Period' },
    RANGES.map(([d, label]) => h('button', {
      type: 'button',
      class: d === days ? 'is-on' : null,
      onclick: () => { state.analyticsDays = d; store.set('cms-analytics-days', d); renderPanel(); },
    }, label)));

  const draw = (data) => {
    if (data.state !== 'ok') body.replaceChildren(analyticsHelp(data.state, data.message));
    else body.replaceChildren(...analyticsView(data).flat().filter(Boolean));
  };
  const cached = state.analyticsCache[days];
  if (cached && Date.now() - cached.at < 5 * 60e3) draw(cached.data);
  else {
    body.replaceChildren(h('p.hint', 'Loading…'));
    (state.conn ? api(`/analytics?days=${days}`) : Promise.resolve({ state: 'offline' }))
      .then((data) => {
        if (data.state === 'ok') state.analyticsCache[days] = { at: Date.now(), data };
        if (state.tab === 'analytics' && state.analyticsDays === days) draw(data);
      })
      .catch((e) => { if (state.tab === 'analytics') draw({ state: 'error', message: e.message }); });
  }
  return [h('div.analytics__head', h('p.intro', { style: { margin: 0 } }, 'Visits to your site.'), ranges), body];
}

/* ---------- panels ---------- */
const panels = {
  analytics: analyticsPanel,
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
          onDelete: () => { list.splice(i, 1); for (const cs of c.caseStudies) if (cs.project === p.id) cs.project = ''; changed(); renderPanel(); },
          body: () => [
            text('Title', p, 'title', { onInput: () => { const t = $('.card__title', document.activeElement.closest('.card')); if (t) t.firstChild.textContent = p.title || 'Untitled'; } }),
            text('Link', p, 'url', { type: 'url', placeholder: 'https://… (optional)', hint: 'When set, the title links here and shows an arrow.' }),
            imageField('Image', p, 'image', 'project', {
              hint: col === 'left' ? 'Shown at 1896 × 1456 (landscape, cropped to fit).' : 'Shown square, cropped to fit.',
              nameHint: () => p.title, onChange: renderPanel, focusKey: 'imageFocus',
            }),
            text('Image description (alt text)', p, 'imageAlt', { hint: 'Describes the image for screen readers and search engines.' }),
            area('Description', p, 'text', { rows: 8 }),
            tagsField(p.tags),
            select('Column', p, 'column', [['left', 'Left — large landscape image'], ['right', 'Right — square image']], renderPanel),
            caseStudyEntry(p),
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

  caseStudies() {
    const c = state.content, list = c.caseStudies;
    return [
      h('p.intro', 'Longer pages about individual projects, at /work/…/. Link each one to a homepage project, or make it unlisted so only people with the link can see it.'),
      list.length ? h('div.list', list.map((cs, i) => {
        const p = projectOf(c, cs);
        const thumb = cs.heroImage || p?.image;
        const open = () => openCaseStudy(cs);
        const row = h('div.card.cs-row', h('div.card__head', { role: 'button', tabindex: 0, onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
          thumb ? h('img.card__thumb', { src: assetUrl(thumb), alt: '' }) : imagePlaceholder('card__thumb'),
          h('div.card__title', caseStudyTitle(c, cs), h('span.muted', p ? `Project: ${p.title}` : 'No project', ' · ', `/work/${cs.id}/`)),
          statusBadge(cs),
          h('div.card__tools',
            h('button.icon-btn', { type: 'button', title: 'Move up', disabled: i === 0, onclick: (e) => { e.stopPropagation(); move(list, i, i - 1); } }, '↑'),
            h('button.icon-btn', { type: 'button', title: 'Move down', disabled: i === list.length - 1, onclick: (e) => { e.stopPropagation(); move(list, i, i + 1); } }, '↓'))));
        return row;
      })) : h('p.hint', 'No case studies yet.'),
      h('button.btn.add', { type: 'button', onclick: () => createCaseStudy() }, '+ New case study'),
      list.length > 1 && h('p.hint', { style: { marginTop: '12px' } }, 'The order sets which case study each page suggests next.'),
    ];
  },

  intro() {
    const i = state.content.intro;
    return [
      h('p.intro', 'The text at the top of the page.'),
      text('Name', i, 'name'),
      area('Introduction', i, 'tagline', { rows: 4, hint: 'Shown under your name.' }),
      area('About', i, 'bio', { rows: 10, hint: 'Shown on the right. Enter starts a new paragraph.' }),
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
  if (state.caseFor && !state.content.caseStudies.includes(state.caseFor)) state.caseFor = null;
  if (!panels[state.tab]) state.tab = 'projects';
  const content = state.caseFor && state.tab === 'caseStudies' ? caseStudyPanel(state.caseFor) : panels[state.tab]();
  panel.replaceChildren(...[content].flat(Infinity).filter(Boolean));
  panel.scrollTop = scroll;
  $$('.tabs button').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === state.tab));
}

/* ---------- connection ---------- */
function updateConn() {
  const el = $('#conn');
  el.classList.toggle('is-ok', !!state.conn);
  el.textContent = state.conn ? `Publishing to ${state.conn.branch}` : 'Preview only — publishing works on the live site';
  el.title = state.conn ? `${state.conn.owner}/${state.conn.repo} · ${state.conn.branch}` : '';
}

/* ---------- publish ---------- */
function summarise() {
  const a = state.published, b = state.content, out = [];
  const keyed = (list) => new Map(list.map((p) => [p.id || p.title, p]));
  const pa = keyed(a.projects || []), pb = keyed(b.projects || []);
  for (const [k, p] of pb) if (!pa.has(k)) out.push(`Added project “${p.title}”`);
  for (const [k, p] of pa) if (!pb.has(k)) out.push(`Removed project “${p.title}”`);
  for (const [k, p] of pb) if (pa.has(k) && JSON.stringify(pa.get(k)) !== JSON.stringify(p)) out.push(`Edited project “${p.title}”`);
  if (JSON.stringify((a.projects || []).map((p) => p.id)) !== JSON.stringify((b.projects || []).map((p) => p.id)) && !out.length) out.push('Reordered projects');
  const ca = new Map((a.caseStudies || []).map((x) => [x.id, x])), cb = new Map((b.caseStudies || []).map((x) => [x.id, x]));
  for (const [k, x] of cb) {
    if (!ca.has(k)) out.push(`Added case study “${caseStudyTitle(b, x)}”`);
    else if (JSON.stringify(ca.get(k)) !== JSON.stringify(x)) out.push(`Edited case study “${caseStudyTitle(b, x)}”`);
  }
  for (const [k, x] of ca) if (!cb.has(k)) out.push(`Removed case study “${caseStudyTitle(a, x)}”`);
  if (JSON.stringify(a.intro) !== JSON.stringify(b.intro)) out.push('Edited intro');
  if (JSON.stringify(a.highlights) !== JSON.stringify(b.highlights)) out.push('Edited highlights');
  if (JSON.stringify(a.footer) !== JSON.stringify(b.footer)) out.push('Edited footer');
  if (JSON.stringify(a.site) !== JSON.stringify(b.site)) out.push('Updated settings & SEO');
  const imgs = referencedPaths(b).length;
  if (imgs) out.push(`${imgs} new image${imgs > 1 ? 's' : ''}`);
  return out;
}

$('#btn-publish').addEventListener('click', () => {
  if (!state.conn) { toast('Publishing only works on the live site’s /admin page.'); return; }
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
  const pages = renderPages(content);
  for (const page of pages) tree.push({ path: page.path, mode: '100644', type: 'blob', content: page.html });

  // Remove case study pages that are no longer published.
  const keep = new Set(pages.map((p) => p.path));
  const existing = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
  for (const f of existing.tree || []) {
    if (f.type === 'blob' && /^work\/[^/]+\/index\.html$/.test(f.path) && !keep.has(f.path)) {
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
    }
  }

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

$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  state.tab = b.dataset.tab; store.set('cms-tab', state.tab);
  if (state.caseFor) { state.caseFor = null; showPreviewPage('home'); }
  else if (state.tab !== 'caseStudies' && state.previewPage !== 'home') showPreviewPage('home');
  $('#panel').scrollTop = 0; renderPanel();
}));
// Light / dark interface toggle (starts from the system setting, then remembers the choice).
const isDark = () => (document.documentElement.dataset.theme
  ? document.documentElement.dataset.theme === 'dark'
  : matchMedia('(prefers-color-scheme: dark)').matches);
function labelThemeButton() {
  const label = isDark() ? 'Switch to light mode' : 'Switch to dark mode';
  $('#btn-theme').title = label;
  $('#btn-theme').setAttribute('aria-label', label);
}
$('#btn-theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cms-theme', next); } catch { /* ignore */ }
  labelThemeButton();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', labelThemeButton);
labelThemeButton();

$('#preview-page').addEventListener('change', (e) => {
  showPreviewPage(e.target.value);
  const cs = state.content.caseStudies.find((x) => x.id === e.target.value);
  if (cs) { state.caseFor = cs; state.tab = 'caseStudies'; } else state.caseFor = null;
  $('#panel').scrollTop = 0; renderPanel();
});
$$('.bar__mid .seg').forEach((b) => b.addEventListener('click', () => {
  $('.layout').dataset.view = b.dataset.view;
  $$('.bar__mid .seg').forEach((x) => x.classList.toggle('is-on', x === b));
}));
// Render the preview at the real device width and scale it down to fit.
// Drag the handles either side of the preview to set a custom width.
const DEVICE_WIDTH = { desktop: 1440, tablet: 810, mobile: 390 };
const MIN_WIDTH = 320, MAX_WIDTH = 2560;
state.customWidth = store.get('cms-custom-width', null);
const previewWidth = () => (state.device === 'custom' && state.customWidth) || DEVICE_WIDTH[state.device] || 1440;
const stagePad = () => (state.device === 'desktop' ? 0 : 32);

function fitPreview(fixedScale) {
  const stage = $('.preview__stage'), frame = $('#preview');
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return 1;
  const w = previewWidth(), pad = stagePad();
  const scale = fixedScale || Math.min(1, (W - pad) / w);
  frame.style.width = `${w}px`;
  frame.style.height = `${(H - pad) / scale}px`;
  frame.style.transform = `translateX(-50%) scale(${scale})`;
  // Keep the handles on the frame's edges (inside the stage when the frame fills it).
  const half = Math.min((w * scale) / 2, W / 2 - 8);
  $('.handle--l').style.left = `${W / 2 - half - 6}px`;
  $('.handle--r').style.left = `${W / 2 + half + 6}px`;
  return scale;
}
new ResizeObserver(() => fitPreview()).observe($('.preview__stage'));

function showCustomWidth() {
  const btn = $('.devices [data-device=custom]');
  btn.hidden = !state.customWidth;
  $('#custom-width').textContent = state.customWidth || '';
}

const setDevice = (d) => {
  if (d === 'custom' && !state.customWidth) d = 'desktop';
  state.device = d; store.set('cms-device', d);
  $('.layout').dataset.device = d;
  $$('.devices button').forEach((x) => x.classList.toggle('is-on', x.dataset.device === d));
  showCustomWidth();
  fitPreview();
};

function setCustomWidth(w) {
  state.customWidth = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));
  if (state.device !== 'custom') {
    state.device = 'custom';
    $('.layout').dataset.device = 'custom';
    $$('.devices button').forEach((x) => x.classList.toggle('is-on', x.dataset.device === 'custom'));
  }
  showCustomWidth();
  $('#size-badge').textContent = `${state.customWidth}px`;
}
function saveCustomWidth() {
  store.set('cms-custom-width', state.customWidth);
  store.set('cms-device', 'custom');
}

$$('.handle').forEach((handle) => {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const stage = $('.preview__stage');
    const rect = stage.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    // Keep the zoom fixed while dragging so the handle tracks the pointer.
    const scale = Math.min(1, (stage.clientWidth - 32) / previewWidth());
    const badge = $('#size-badge');
    document.body.classList.add('is-resizing');
    badge.hidden = false;
    const move = (ev) => {
      setCustomWidth((2 * Math.abs(ev.clientX - cx)) / scale);
      // Track the pointer at the starting zoom; zoom out only once the frame would overflow.
      fitPreview(state.customWidth * scale <= stage.clientWidth - 32 ? scale : undefined);
    };
    move(e);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      document.body.classList.remove('is-resizing');
      badge.hidden = true;
      saveCustomWidth();
      fitPreview();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
  // Keyboard: arrow keys resize by 10px (50px with Shift).
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const outward = (e.key === 'ArrowRight') === (handle.dataset.side === '1');
    setCustomWidth(previewWidth() + (outward ? 1 : -1) * (e.shiftKey ? 50 : 10));
    saveCustomWidth();
    fitPreview();
  });
});
$$('.devices button').forEach((b) => b.addEventListener('click', () => setDevice(b.dataset.device)));
setDevice(state.device);

load().catch((e) => { $('#panel').replaceChildren(h('p.msg.err', `Couldn't start the editor: ${e.message}`)); });
