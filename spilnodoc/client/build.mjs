// Збирання клієнтської частини в каталог public/assets за допомогою esbuild.
// Запуск: npm run build  (або npm run dev для автоматичного перезбирання)
import * as esbuild from 'esbuild';

const options = {
  entryPoints: ['client/src/main.jsx'],
  bundle: true,
  outfile: 'public/assets/app.js',
  format: 'esm',
  jsx: 'automatic',
  target: ['es2022'],
  minify: !process.argv.includes('--watch'),
  sourcemap: process.argv.includes('--watch'),
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
