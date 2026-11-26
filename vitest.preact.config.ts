import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/preact.test.tsx'],
    server: {
      deps: {
        inline: [/node_modules\/react-router(-dom)?\//],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^react-router$/, replacement: path.resolve(__dirname, './node_modules/react-router/esm/react-router.js') },
      { find: /^react-router-dom$/, replacement: path.resolve(__dirname, './node_modules/react-router-dom/esm/react-router-dom.js') },
      { find: /^react-dom\/client$/, replacement: path.resolve(__dirname, './node_modules/preact/compat/client.mjs') },
      { find: /^react-dom\/test-utils$/, replacement: path.resolve(__dirname, './node_modules/preact/test-utils/dist/testUtils.mjs') },
      { find: /^react\/jsx-runtime$/, replacement: path.resolve(__dirname, './node_modules/preact/compat/jsx-runtime.mjs') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(__dirname, './node_modules/preact/compat/jsx-dev-runtime.mjs') },
      { find: /^react-dom$/, replacement: path.resolve(__dirname, './node_modules/preact/compat/dist/compat.mjs') },
      { find: /^react$/, replacement: path.resolve(__dirname, './node_modules/preact/compat/dist/compat.mjs') },
    ],
  },
});
