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

### First-time setup

The CMS publishes with a GitHub token that stays in your browser:

1. Go to [GitHub → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new).
2. **Repository access:** only `jamingalea/jamingalea-com`.
3. **Permissions → Repository → Contents:** Read and write.
4. In the CMS, click **Not connected** (top left) and paste the token.

Repeat on each device you edit from. Use **Forget token** on shared computers.

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
| `images/`, `fonts/` | Assets |

If you edit `content.json` by hand, regenerate the page with:

```bash
node build.mjs
```
