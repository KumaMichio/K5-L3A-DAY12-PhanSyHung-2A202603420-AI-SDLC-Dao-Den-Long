import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist-web' },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
