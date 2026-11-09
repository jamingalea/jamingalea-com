// Password protection for the CMS at /admin, run by Vercel before any
// /admin file is sent. It also publishes to GitHub on the CMS's behalf, so
// the GitHub token never reaches the browser.
//
// Settings (Vercel → Project → Settings → Environment Variables):
//   CMS_PASSWORD   the password for /admin                         (required)
//   GITHUB_TOKEN   fine-grained token, Contents: Read and write    (required)
//   CMS_REPO       owner/repo to publish to   (default jamingalea/jamingalea-com)
//   CMS_BRANCH     branch Vercel deploys from (default main)
import { next } from '@vercel/functions';

export const config = { matcher: ['/admin', '/admin/:path*'] };

const COOKIE = 'cms_session';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const password = process.env.CMS_PASSWORD || '';
  const token = process.env.GITHUB_TOKEN || '';

  // Fail closed: without settings, nothing is served.
  if (!password || !token) return page(setupPage(!password, !token), 503);

  if (path === '/admin/login') {
    if (request.method === 'POST') return login(request, password, token);
    return redirect('/admin/');
  }
  if (path === '/admin/logout') {
    return redirect('/admin/', { 'Set-Cookie': `${COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  const signedIn = await verifySession(readCookie(request, COOKIE), password, token);
  if (!signedIn) {
    if (path.startsWith('/admin/api/')) return json({ message: 'Signed out' }, 401);
    return page(loginPage(), 401);
  }
  if (path.startsWith('/admin/api/')) return api(request, url, token);
  return next({ headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

/* ---------- sessions: "<expiry>.<signature>" in an HttpOnly cookie ---------- */

// Changing the password (or token) signs every device out.
async function sessionKey(password, token) {
  const secret = await crypto.subtle.digest('SHA-256', enc.encode(`cms-session\u0000${password}\u0000${token}`));
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function createSession(password, token) {
  const expires = String(Date.now() + SESSION_DAYS * 864e5);
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(password, token), enc.encode(expires));
  return `${expires}.${b64url(sig)}`;
}

async function verifySession(value, password, token) {
  const m = /^(\d{13,})\.([A-Za-z0-9_-]+)$/.exec(value || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  try {
    return await crypto.subtle.verify('HMAC', await sessionKey(password, token), fromB64url(m[2]), enc.encode(m[1]));
  } catch { return false; }
}

// Compare passwords without leaking how many characters matched.
async function samePassword(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

async function login(request, password, token) {
  let given = '';
  try { given = String((await request.formData()).get('password') || ''); } catch { /* empty */ }
  if (!(await samePassword(given, password))) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return page(loginPage('That password isn’t right.'), 401);
  }
  const session = await createSession(password, token);
  return redirect('/admin/', {
    'Set-Cookie': `${COOKIE}=${session}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

/* ---------- API used by the CMS ---------- */

// Only what publishing needs: read the repo, files and branch; write blobs, trees, commits and the branch ref.
const ALLOWED = /^(|branches\/[^/]+|contents\/[^?]+|git\/(ref|refs)\/heads\/[^/].*|git\/(commits|trees|blobs)(\/[0-9a-f]{40})?)$/;

async function api(request, url, token) {
  // Requests must come from the CMS page itself (a custom header can't be sent cross-site without permission).
  if (request.headers.get('x-cms') !== '1') return json({ message: 'Forbidden' }, 403);
  const repo = process.env.CMS_REPO || 'jamingalea/jamingalea-com';
  const branch = process.env.CMS_BRANCH || 'main';

  if (url.pathname === '/admin/api/analytics') return analytics(url);

  if (url.pathname === '/admin/api/config') {
    const [owner, name] = repo.split('/');
    return json({ owner, repo: name, branch });
  }

  const m = /^\/admin\/api\/github\/?(.*)$/.exec(url.pathname);
  if (!m || !ALLOWED.test(m[1])) return json({ message: 'Not allowed' }, 404);
  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH'].includes(method)) return json({ message: 'Not allowed' }, 405);

  const res = await fetch(`https://api.github.com/repos/${repo}${m[1] ? '/' + m[1] : ''}${url.search}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'portfolio-cms',
      ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method !== 'GET' ? await request.text() : undefined,
  });
  const body = await res.text();
  // A rejected token is a settings problem, not a signed-out browser: don't send it back as 401.
  if (res.status === 401) return json({ message: 'GitHub rejected the GITHUB_TOKEN in your Vercel settings. It may have expired.' }, 502);
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' },
  });
}

/* ---------- analytics (Vercel Web Analytics, read with ANALYTICS_TOKEN) ---------- */

const PROJECT_ID = process.env.ANALYTICS_PROJECT_ID || 'prj_A2scubKMfee5RzGqYQcGDHYgPHu6';
const TEAM_ID = process.env.ANALYTICS_TEAM_ID || 'team_9oQSoIcbm43jRphF3AC58PfI';

// Rows come back as { <dimension>: value, <count fields> }. Read the counts tolerantly.
const firstNumber = (row, keys) => { for (const k of keys) if (typeof row?.[k] === 'number') return row[k]; return 0; };
const counts = (row) => ({
  pageviews: firstNumber(row, ['count', 'total', 'pageViews', 'pageviews', 'views']),
  visitors: firstNumber(row, ['visitors', 'devices', 'uniqueVisitors']),
});

async function analytics(url) {
  const token = process.env.ANALYTICS_TOKEN;
  if (!token) return json({ state: 'no-token' });
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 30));
  const until = new Date();
  const since = new Date(until.getTime() - days * 864e5);

  const query = async (path, params) => {
    const qs = new URLSearchParams({ projectId: PROJECT_ID, teamId: TEAM_ID, since: since.toISOString(), until: until.toISOString(), ...params });
    const res = await fetch(`https://api.vercel.com/v1/query/web-analytics/visits/${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = body?.error?.code || '';
      const err = new Error(body?.error?.message || `HTTP ${res.status}`);
      err.state = code === 'web_analytics_not_enabled' ? 'not-enabled' : res.status === 401 || res.status === 403 ? 'bad-token' : 'error';
      throw err;
    }
    return body;
  };
  const rows = (body, dim) => (Array.isArray(body?.data) ? body.data : []).map((r) => ({ key: r[dim] ?? r.key ?? r.value ?? '', ...counts(r) }));

  try {
    const [total, daily, countries, sources, pages] = await Promise.all([
      query('count', {}),
      query('aggregate', { by: 'day', limit: '100' }),
      query('aggregate', { by: 'country', limit: '10' }),
      query('aggregate', { by: 'referrerHostname', limit: '10' }),
      query('aggregate', { by: 'requestPath', limit: '100' }),
    ]);
    return new Response(JSON.stringify({
      state: 'ok',
      days,
      since: since.toISOString(),
      until: until.toISOString(),
      totals: counts(total?.data ?? total),
      daily: (Array.isArray(daily?.data) ? daily.data : []).map((r) => ({ day: String(r.timestamp ?? r.day ?? r.date ?? '').slice(0, 10), ...counts(r) })),
      countries: rows(countries, 'country'),
      sources: rows(sources, 'referrerHostname'),
      pages: rows(pages, 'requestPath'),
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    return json({ state: e.state || 'error', message: e.message });
  }
}

/* ---------- responses ---------- */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const redirect = (to, headers = {}) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store', ...headers } });

const page = (html, status) =>
  new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
    },
  });

const shell = (body) => `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Portfolio CMS</title>
<style>
:root{--bg:#f6f6f4;--panel:#fff;--fg:#1b1b1a;--muted:#6b6b66;--line:#e3e3df;--field:#fff;--accent:#1f1f1f;--accent-fg:#fff;--focus:#3b6fe0;--danger:#c4352b}
@media (prefers-color-scheme:dark){:root{--bg:#131313;--panel:#1b1b1b;--fg:#ededea;--muted:#9a9a94;--line:#2b2b2a;--field:#141414;--accent:#ededea;--accent-fg:#141414;--focus:#7aa2ff;--danger:#ff7b6e}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:min(360px,100%)}
h1{font-size:18px;margin:0 0 6px}
p{margin:0 0 24px;color:var(--muted)}
label{display:block;font-weight:500;margin-bottom:8px}
input{width:100%;font:inherit;color:inherit;background:var(--field);border:1px solid var(--line);border-radius:8px;padding:11px 13px}
input:focus{outline:none;border-color:var(--focus);box-shadow:0 0 0 3px color-mix(in srgb,var(--focus) 22%,transparent)}
button{width:100%;margin-top:16px;font:inherit;font-weight:500;background:var(--accent);color:var(--accent-fg);border:0;border-radius:8px;padding:11px;cursor:pointer}
.err{color:var(--danger);margin:12px 0 0;font-size:14px}
code{font-size:13px;background:color-mix(in srgb,var(--muted) 15%,transparent);padding:1px 5px;border-radius:4px}
ul{padding-left:20px;margin:0;color:var(--muted)}
</style></head><body><main class="card">${body}</main></body></html>`;

const loginPage = (error = '') => shell(`
<form method="post" action="/admin/login">
  <input name="password" type="password" aria-label="Password" autocomplete="current-password" required autofocus>
  ${error ? `<p class="err" role="alert">${error}</p>` : ''}
  <button type="submit">Sign in</button>
</form>`);

const setupPage = (noPassword, noToken) => shell(`
<h1>Portfolio CMS isn’t set up yet</h1>
<p>Add these in Vercel → your project → Settings → Environment Variables, then redeploy:</p>
<ul>
  ${noPassword ? '<li><code>CMS_PASSWORD</code>: the password for this page</li>' : ''}
  ${noToken ? '<li><code>GITHUB_TOKEN</code>: a fine-grained GitHub token for this repository, with Contents: Read and write</li>' : ''}
</ul>`);
