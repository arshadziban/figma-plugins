import { build, context } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

const codeOptions = {
  entryPoints: ['src/code.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  format: 'iife',
  target: 'es2017',
  logLevel: 'info',
};

// UI: bundle in memory, then inline into ui.html (Figma loads the UI from one string).
const uiOptions = {
  entryPoints: ['src/ui.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2019',
  minify: !watch,
  logLevel: 'info',
  plugins: [
    {
      name: 'inline-ui',
      setup(b) {
        b.onEnd((result) => {
          const js = result.outputFiles?.[0]?.text;
          if (!js) return;
          const html = readFileSync('src/ui.html', 'utf8');
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
