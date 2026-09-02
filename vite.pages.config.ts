import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'browser',
  base: './',
  publicDir: '../public',
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  define: { 'import.meta.env.VITE_BROWSER_EDITION': JSON.stringify('true') },
  build: { outDir: '../dist-pages', emptyOutDir: false, sourcemap: false },
});
