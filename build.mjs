// Regenerates index.html from content.json.
// Usage: node build.mjs
// The /admin editor does the same thing in the browser when you publish,
// so you only need this when editing content.json by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { renderSite } from './render.mjs';

const content = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
writeFileSync(new URL('./index.html', import.meta.url), renderSite(content));
console.log('index.html written');
