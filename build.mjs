// Regenerates the site's HTML from content.json: index.html plus
// work/<project>/index.html for each project with a published case study.
// Usage: node build.mjs
// The /admin editor does the same thing in the browser when you publish,
// so you only need this when editing content.json by hand.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPages } from './render.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(readFileSync(join(root, 'content.json'), 'utf8'));
const pages = renderPages(content);

for (const { path, html } of pages) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), html);
  console.log('wrote', path);
}

// Remove case study pages that are no longer published.
const keep = new Set(pages.map((p) => p.path));
const work = join(root, 'work');
if (existsSync(work)) {
  for (const dir of readdirSync(work)) {
    const path = `work/${dir}/index.html`;
    if (!keep.has(path) && existsSync(join(root, path))) {
      rmSync(join(root, path));
      console.log('removed', path);
    }
  }
}
