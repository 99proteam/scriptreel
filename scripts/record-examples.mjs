// Record every script in examples/ against the local test site.
// Usage: npm run examples            (builds first)
import { mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { record } from '../dist/index.js';
import { serveSite } from '../tests/site/server.mjs';

const only = process.argv.slice(2);
const site = await serveSite(Number(process.env.PORT ?? 4173)).catch(() => serveSite(0));
const env = { ...process.env, SITE_URL: site.url };
await mkdir('examples/output', { recursive: true });

try {
  const files = (await readdir('examples')).filter((f) => f.endsWith('.yml') && (only.length === 0 || only.some((o) => f.includes(o))));
  for (const file of files) {
    const name = basename(file, '.yml');
    const started = Date.now();
    process.stdout.write(`Recording ${file} ... `);
    const outputs = [join('examples/output', `${name}.mp4`)];
    // The login flow doubles as the README preview GIF.
    if (name === 'login-flow') outputs.push(join('docs', 'demo.gif'));
    const result = await record(join('examples', file), { output: outputs, env });
    console.log(`${(result.duration / 1000).toFixed(1)}s video in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
} finally {
  await site.close();
}
