import { build, context } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

// Main thread: Figma's sandbox is happiest with a conservative target.
const codeOptions = {
  entryPoints: ['src/code.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  format: 'iife',
  target: 'es2017',
  logLevel: 'info',
};

// UI: bundle in memory, then inline into ui.html (Figma loads the UI from one string).
// Use PptxGenJS's ES build so esbuild bundles JSZip itself (the UMD bundle expects a global JSZip).
// Its fs/https requires sit behind `typeof window === 'undefined'`, so they never run in the iframe.
const uiOptions = {
  entryPoints: ['src/ui.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2019',
  minify: !watch,
  alias: { pptxgenjs: 'pptxgenjs/dist/pptxgen.es.js' },
  external: ['fs', 'https'],
  logLevel: 'info',
  plugins: [
    {
      name: 'inline-ui',
      setup(b) {
        b.onEnd((result) => {
          const js = result.outputFiles?.[0]?.text;
          if (!js) return;
          const html = readFileSync('src/ui.html', 'utf8');
          // Escape "</script" so the inlined bundle can't close its own tag.
          const safe = js.replace(/<\/script/gi, '<\\/script');
          writeFileSync('dist/ui.html', html.replace('<!-- SCRIPT -->', () => `<script>${safe}</script>`));
        });
      },
    },
  ],
};

if (watch) {
  await (await context(codeOptions)).watch();
  await (await context(uiOptions)).watch();
} else {
  await build(codeOptions);
  await build(uiOptions);
}
