import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    // Everything the game needs at start stays in one file; only the pages loaded later (puzzle,
    // store, full map) are split off. Shared modules would otherwise become extra startup chunks.
    rolldownOptions: { output: { advancedChunks: { groups: [{ name: 'game', test: /src\/(?!ui\/(store|fullmap|puzzle))|node_modules/ }] } } },
  },
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
