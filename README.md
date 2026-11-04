# jamingalea.com

A static portfolio site. All its words, images and settings live in
[`content.json`](content.json). The page (`index.html`) is generated from that file.

## Editing content: the CMS

Open **https://jamingalea.com/admin/**. From there you can:

- edit the intro text, every project, the “Other highlights” row and the footer links
- add, duplicate, reorder, hide or delete projects and highlights
- upload or replace images (large images are resized automatically)
- change the page title, description, share (OG) image, favicon and home-screen icon
- see a live preview at desktop, tablet and phone sizes before publishing

### Case study pages

Open a project and press **Start case study →**. A case study has a summary, project
details (Role, Year…), a main image and a body built from blocks: Text, Image, Image row,
Quote and Numbers. Pick a case study in the preview's page menu to see it.

Case studies stay as drafts until you tick **Publish this case study**. Then publishing
creates the page at `/work/<project>/`, and the project on the homepage links to it.
Switch it off again and the page is removed on the next publish.

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

### Writing text

- Leave a blank line between paragraphs.
- Links: `[link text](https://example.com)`.
- Tags can be marked **Green**, like “Case study available on request”.

## Files

| File | What it does |
| --- | --- |
| `content.json` | All the site content and settings |
| `render.mjs` | Turns `content.json` into the page HTML (used by the CMS and `build.mjs`) |
| `site.css`, `site.js` | Page styles and the small scroll effects |
| `index.html` | Generated. Don't edit by hand |
| `admin/` | The CMS |
| `middleware.js` | Password protection for `/admin`, and publishing to GitHub |
| `images/`, `fonts/` | Assets |

If you edit `content.json` by hand, regenerate the page with:

```bash
node build.mjs
```
