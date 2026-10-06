// Assemble the GitHub Pages site in _site/: the landing page plus the example scripts and the videos rendered
// from them, so the "script → video" demo on the site always matches the repository.
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = '_site';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'videos'), { recursive: true });
mkdirSync(join(out, 'examples'), { recursive: true });

cpSync('website', out, { recursive: true });
cpSync('docs/social-preview.png', join(out, 'social-preview.png'));
for (const file of readdirSync('examples')) {
  if (file.endsWith('.yml')) cpSync(join('examples', file), join(out, 'examples', file));
}
for (const file of readdirSync('examples/output')) {
  if (file.endsWith('.mp4')) cpSync(join('examples/output', file), join(out, 'videos', file));
}
writeFileSync(join(out, '.nojekyll'), '');

console.log(`Website built in ${out}/`);
