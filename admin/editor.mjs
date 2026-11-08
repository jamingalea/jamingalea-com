// A small rich text editor for the CMS: bold, italic and links.
// Content is still stored in the site's simple text format (see inline() in
// render.mjs), so pasted styling can never leak onto the site.
import { paragraphs } from '/render.mjs';

const BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/;

/* ---------- HTML in the editor → stored text ---------- */
const escapeText = (t) => t.replace(/ /g, ' ').replace(/[\\*_[\]]/g, '\\$&');

// Put marks around the words, not the spaces next to them: "** bold **" isn't bold.
function wrap(mark, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function inlineToText(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.data);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.tagName === 'BR') return '\n';
  let inner = [...node.childNodes].map(inlineToText).join('');
  const style = node.style || {};
  const bold = /^(B|STRONG)$/.test(node.tagName) || /^(bold|[6-9]00)$/.test(style.fontWeight || '');
  const italic = /^(I|EM)$/.test(node.tagName) || style.fontStyle === 'italic';
  if (italic) inner = wrap('_', inner);
  if (bold) inner = wrap('**', inner);
  if (node.tagName === 'A' && node.getAttribute('href')) {
    const href = node.getAttribute('href').trim().replace(/[()\s]/g, encodeURIComponent);
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    if (m[2]) inner = `${m[1]}[${m[2]}](${href})${m[3]}`;
  }
  return inner;
}

export function htmlToText(root) {
  const blocks = [];
  let current = '';
  const flush = () => {
    const t = current.replace(/^[ \t]*\n+|\n+[ \t]*$/g, '').replace(/[ \t]+\n/g, '\n');
    if (t.trim()) blocks.push(t.trim());
    current = '';
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && BLOCK.test(child.tagName)) { flush(); walk(child); flush(); }
      else current += inlineToText(child);
    }
  };
  walk(root);
  flush();
  return blocks.join('\n\n');
}

/* ---------- links ---------- */
export function normaliseUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (/^[a-z][\w+.-]*:/i.test(url) || /^[/#]/.test(url)) return url;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

const ICONS = {
  bold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/></svg>',
  italic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5h8M6 19h8M14.5 5l-5 14"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  unlink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/><path d="M4 4l16 16"/></svg>',
};

let separatorSet = false;

/**
 * Creates an editor.
 * @param {object} o
 * @param {string} o.value        stored text
 * @param {(text:string)=>void} o.onChange
 * @param {string} [o.label]      accessible name
 * @param {string} [o.placeholder]
 * @param {number} [o.rows]
 * @param {(msg:string)=>void} [o.notify]
 */
export function richText({ value, onChange, label, placeholder, rows = 6, notify = () => {} }) {
  if (!separatorSet) { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* ignore */ } separatorSet = true; }

  const wrapEl = document.createElement('div');
  wrapEl.className = 'rte';

  const bar = document.createElement('div');
  bar.className = 'rte__bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', `${label || 'Text'} formatting`);
  const button = (name, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rte__btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = ICONS[name];
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection
    bar.append(b);
    return b;
  };
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const bBold = button('bold', `Bold (${mod}B)`);
  const bItalic = button('italic', `Italic (${mod}I)`);
  const bLink = button('link', `Link (${mod}K)`);
  const bUnlink = button('unlink', 'Remove link');

  const body = document.createElement('div');
  body.className = 'rte__body';
  body.contentEditable = 'true';
  body.setAttribute('role', 'textbox');
  body.setAttribute('aria-multiline', 'true');
  if (label) body.setAttribute('aria-label', label);
  if (placeholder) body.dataset.placeholder = placeholder;
  body.style.minHeight = `${Math.max(2, rows) * 1.6 + 1.5}em`;
  body.innerHTML = value ? paragraphs(value) : '<p><br></p>';
  body.querySelectorAll('a').forEach((a) => { a.removeAttribute('target'); a.removeAttribute('rel'); });

  // Link popover
  const pop = document.createElement('div');
  pop.className = 'rte__pop';
  pop.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Paste or type a link, e.g. popsa.com';
  input.setAttribute('aria-label', 'Link address');
  const apply = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--sm btn--primary', textContent: 'Apply' });
  const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--sm btn--ghost', textContent: 'Cancel' });
  pop.append(input, apply, cancel);

  wrapEl.append(bar, body, pop);

  const sync = () => {
    const text = htmlToText(body);
    body.classList.toggle('is-empty', !text);
    onChange(text);
  };
  body.classList.toggle('is-empty', !value);

  const selectionInBody = () => {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    return body.contains(r.commonAncestorContainer) ? r : null;
  };
  const linkAt = (range) => {
    let n = range && range.commonAncestorContainer;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentNode;
    const a = n && n.closest ? n.closest('a') : null;
    return a && body.contains(a) ? a : null;
  };
  const refresh = () => {
    const r = selectionInBody();
    let bold = false, italic = false;
    try { bold = !!r && document.queryCommandState('bold'); italic = !!r && document.queryCommandState('italic'); } catch { /* ignore */ }
    bBold.classList.toggle('is-on', bold);
    bItalic.classList.toggle('is-on', italic);
    const a = r && linkAt(r);
    bLink.classList.toggle('is-on', !!a);
    bUnlink.disabled = !a;
  };
  // Track the selection only while this editor is on screen.
  let attached = false;
  const onSelection = () => {
    if (wrapEl.isConnected) { attached = true; refresh(); }
    else if (attached) document.removeEventListener('selectionchange', onSelection);
  };
  document.addEventListener('selectionchange', onSelection);

  const run = (cmd, arg) => { body.focus(); document.execCommand(cmd, false, arg); sync(); refresh(); };
  bBold.addEventListener('click', () => run('bold'));
  bItalic.addEventListener('click', () => run('italic'));

  let saved = null, editing = null;
  const openLink = () => {
    const r = selectionInBody();
    const a = r && linkAt(r);
    if (!r || (r.collapsed && !a)) { notify('Select the words you want to turn into a link first.'); return; }
    saved = r.cloneRange();
    editing = a;
    input.value = a ? a.getAttribute('href') : '';
    pop.hidden = false;
    input.focus();
    input.select();
  };
  const closeLink = (restore = true) => {
    pop.hidden = true;
    if (restore && saved) { body.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(saved); }
    saved = null; editing = null;
  };
  const applyLink = () => {
    const url = normaliseUrl(input.value);
    const a = editing, r = saved;
    closeLink(true);
    if (!url) { if (a) removeLink(a); return; }
    if (a) a.setAttribute('href', url);
    else if (r) document.execCommand('createLink', false, url);
    body.querySelectorAll('a').forEach((x) => { x.removeAttribute('target'); x.removeAttribute('rel'); });
    sync(); refresh();
  };
  const removeLink = (a) => {
    const r = document.createRange();
    r.selectNodeContents(a);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('unlink');
    sync(); refresh();
  };
  bLink.addEventListener('click', openLink);
  bUnlink.addEventListener('click', () => { const a = linkAt(selectionInBody()); if (a) { body.focus(); removeLink(a); } });
  apply.addEventListener('click', applyLink);
  cancel.addEventListener('click', () => closeLink(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
    if (e.key === 'Escape') { e.preventDefault(); closeLink(true); }
  });

  body.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (k === 'k') { e.preventDefault(); openLink(); }
      if (k === 'b') { e.preventDefault(); run('bold'); }
      if (k === 'i') { e.preventDefault(); run('italic'); }
      if (k === 'u') e.preventDefault(); // no underline on the site
    }
  });
  // Paste as plain text, so styles from other apps don't come along.
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'));
  });
  body.addEventListener('drop', (e) => e.preventDefault());
  body.addEventListener('input', sync);
  // Clicking a link in the editor selects it instead of opening it.
  body.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });

  return wrapEl;
}
