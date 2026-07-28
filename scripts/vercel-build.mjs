import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/vercel-handler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'api/index.cjs',
  format: 'cjs',
  packages: 'external',
});

console.log('Built api/index.cjs');
