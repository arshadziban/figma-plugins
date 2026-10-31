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

// UI: bundle React in memory, then inline into ui.html (Figma loads the UI from one string).
const uiOptions = {
  entryPoints: ['src/ui.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2019',
  jsx: 'automatic',
  minify: !watch,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
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
