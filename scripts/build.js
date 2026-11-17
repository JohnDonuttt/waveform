// There is no bundling step: the site is plain ES modules. "Build" copies
// the files the page needs into dist/ so the deploy contains nothing else.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');
const files = ['index.html', 'styles.css', 'icon.svg', 'src'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of files) cpSync(join(root, f), join(out, f), { recursive: true });
console.log(`Copied ${files.join(', ')} to dist/`);
