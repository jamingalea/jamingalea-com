# jamingalea.com

A static portfolio site. All its words, images and settings live in
[`content.json`](content.json). The page (`index.html`) is generated from that file.

## Editing content: the CMS

Open **https://jamingalea.com/admin/**. From there you can:

- edit the intro text, every project, the “Other highlights” row and the footer links
- add, duplicate, reorder, hide or delete projects and highlights
- upload or replace images (large images are resized automatically)
- set a focal point on project images (**Adjust crop…**): click the part that must stay in
  view, and the site crops around it at every screen size
- change the page title, description, share (OG) image, favicon and home-screen icon
- see a live preview at desktop, tablet and phone sizes before publishing

### Case study pages

Case studies have their own **Case studies** tab. Create one there with **+ New case study**,
or from a project with **Case study → Create →**. Each case study is linked to one homepage
project. Its title, summary and main image fall back to that project's when left empty.
A case study has a summary, project details (Role, Year…), a main image and a body built
from blocks: Text, Image, Image row, Quote and Numbers. Pick a case study in the preview's
page menu to see it.

Case studies stay as drafts until you tick **Publish this case study**. Publishing then
creates the page at `/work/<address>/`, and the linked project on the homepage links to it.
Switch it off again and the page is removed on the next publish.

Tick **Unlisted** for a case study that only people with the link can see. It can be
published without a project, nothing on the site links to it, it's left out of the
"Next case study" links, and search engines are asked not to list it.

The page styles are a plain starting point, in the "Case study pages" section of `site.css`.

Your edits are saved as a draft in that browser until you press **Publish**.
Publishing makes one commit to `main` on GitHub with the new `content.json`, a regenerated
`index.html` and any new images. Vercel then deploys it automatically, usually within a minute.

### Signing in

`/admin` is protected by a password. Nothing in the CMS is sent to a browser until the
right password is entered, and you stay signed in for 30 days on that device
(**More → Sign out** to sign out). Changing the password signs every device out.

Publishing goes through Vercel, which uses a GitHub token kept in your Vercel settings.
The token never reaches the browser.

### First-time setup (once)

1. **Create the GitHub token.** Go to [GitHub → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new).
   - **Token name:** e.g. `Portfolio CMS`. **Expiration:** your choice (a year is sensible).
   - **Repository access:** *Only select repositories* → `jamingalea/jamingalea-com`.
   - **Permissions → Repository permissions → Contents:** Read and write.
   - Generate it and copy it.
2. **Add two settings in Vercel.** Project → **Settings → Environment Variables**:
   - `GITHUB_TOKEN`: paste the token. Tick **Sensitive**.
   - `CMS_PASSWORD`: the password you'll type to sign in. Make it long, e.g. four random words.
3. **Redeploy** (Deployments → ⋯ on the latest → Redeploy) so the settings take effect.

Optional settings: `CMS_REPO` (default `jamingalea/jamingalea-com`) and `CMS_BRANCH` (default `main`).

When the GitHub token expires, create a new one and replace `GITHUB_TOKEN` in Vercel.
Until both settings exist, `/admin` shows a "not set up yet" page and nothing else.

### Visitor cards on side projects

A project can show a small animated card on its **own website**, only to people who
arrive there from this portfolio: who made it, a short message, and links to its case
study and back to the portfolio.

1. In the CMS, open the project → **Visitor card** → switch it on and write the message.
   It appears on the domain of the project's link (add others under **Other domains**).
   Projects not on the homepage yet can be added and hidden (◉); their cards still work.
2. Publish. The cards are saved to `visitor-cards.json`.
3. Once per side project, paste the line shown in the CMS before `</body>`:
   `<script src="https://<portfolio address>/visitor-card.js" defer></script>`

The card appears when the visitor came from the portfolio (the browser's referrer) or
through a portfolio link, which the site tags with `?from=portfolio`; the tag is removed
from the address bar straight away. On later pages of the same visit it shrinks to a small pill. Closing
it hides it for the rest of the visit. If the portfolio moves to a new address, update the
`src` in that line on each side project.

### Analytics

The CMS's **Analytics** tab shows visitors, page views, countries, where visitors came
from and which case studies were viewed, for the last 7, 30 or 90 days. The numbers come
from Vercel Web Analytics, which counts visits without cookies. The CMS preview isn't counted.

Setup (once):
1. In Vercel, open the project → **Analytics** → **Enable**. Counting starts from then.
2. Create a token at Vercel → **Account Settings → Tokens**.
3. Add it in the project → **Settings → Environment Variables** as `ANALYTICS_TOKEN`
   (tick **Sensitive**), then redeploy.

How long people stay isn't measured; Vercel Web Analytics doesn't record it.

### Writing text

- Description boxes have a toolbar: **Bold** (⌘/Ctrl+B), *Italic* (⌘/Ctrl+I), Link (⌘/Ctrl+K)
  and Remove link. Select some words first, then press a button.
- Enter starts a new paragraph; Shift+Enter adds a line break.
- Pasted text arrives as plain text, so styles from other apps don't come along.
- Tags can be marked **Green**, like “Case study available on request”.

Behind the scenes the text is stored in a simple format in `content.json`: `**bold**`,
`_italic_`, `[link text](https://…)`, a blank line between paragraphs.

## Files

| File | What it does |
| --- | --- |
| `content.json` | All the site content and settings |
| `render.mjs` | Turns `content.json` into the page HTML (used by the CMS and `build.mjs`) |
| `site.css`, `site.js` | Page styles and the small scroll effects |
| `index.html` | Generated. Don't edit by hand |
| `admin/` | The CMS |
| `middleware.js` | Password protection for `/admin`, and publishing to GitHub |
| `visitor-card.js` | The card script side projects load; reads `visitor-cards.json` (generated) |
| `images/`, `fonts/` | Assets |
| `styles/` | The page styles (see below): `engine.js`, one `.js` + `.css` pair per style, `fonts.css` and `fonts/` |

If you edit `content.json` by hand, regenerate the page with:

```bash
node build.mjs
```

## Page styles

Each visit draws the homepage in one of several styles (currently `classic`, the original look, `md`, a README file with ASCII images, and `swiss`, a minimal grid). A visitor never gets the same style twice running (remembered in their browser), and after 60 seconds on the page it glitches into another style while keeping them on the same project.

Styles are code only, not in the CMS. They read the same content, so CMS edits show up in every style. The CMS preview and case study pages use the plain layout. `?style=off` shows the plain server-rendered page with no style engine at all.

**Try it:** `?style=classic`, `?style=md`, `?style=swiss` (one style, no switching), `?linger=10` (switch after 10 s), `?linger=off` (never switch by itself).

**Settings** are at the top of `styles/engine.js` (`CONFIG`): `lingerSeconds`, `repeat` (false = switch once per visit), `glitchMs`.

**Add a style:**
1. Copy `styles/swiss.js` and `styles/swiss.css` to `styles/<name>.js` and `.css`, change the `id`, `label`, `css` path and `bg`.
2. Build the page in `render(model, H)`. Mark blocks with `data-anchor` (`intro`, each project's `id`, `highlights`, `highlight-N`, `footer`) so the visitor keeps their place across a switch. Put any sticky bar in an element with `data-chrome`, and avoid `position: fixed` elsewhere.
3. Add `<script src="/styles/<name>.js" defer></script>` before the engine in `styleScripts` in `render.mjs`, then run `node build.mjs`.
4. New fonts go in `styles/fonts/` and `styles/fonts.css` (`@font-face` doesn't work inside a style's own CSS).

Reduced-motion visitors get a short crossfade instead of the glitch.

Optional style hooks: `preload(model)` returns a promise the engine waits for (up to 2.5 s) before showing the style (`md` uses it to turn images into ASCII); `mount(host)` / `unmount(host)` run when the style appears or goes (`classic` uses them for its scroll effects); an element with `data-flat` is laid out flat during the glitch, and `data-anchor-passive` marks a block the visitor can be returned to but that never counts as "where they are" (for sticky areas). To keep a style out of the random rotation but still in the toggle, set `rotate: false`.
