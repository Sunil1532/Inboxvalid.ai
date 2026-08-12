import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';


const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  target: ['es2019'],  
  legalComments: 'none',
};

await build({ ...shared, format: 'iife', minify: true, outfile: 'dist/inboxvalid.min.js' });
await build({ ...shared, format: 'iife', minify: false, outfile: 'dist/inboxvalid.js' });
await build({ ...shared, format: 'esm', minify: false, outfile: 'dist/inboxvalid.esm.js' });

const raw = readFileSync('dist/inboxvalid.min.js');
console.log(`minified ${(raw.length / 1024).toFixed(1)} kB / gzip ${(gzipSync(raw).length / 1024).toFixed(1)} kB`);
