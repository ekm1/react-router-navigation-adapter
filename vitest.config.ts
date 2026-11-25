import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    server: {
      deps: {
        inline: [/@react-navigation/],
      },
    },
  },
  resolve: {
    alias: {
      'react-native': path.resolve(__dirname, './tests/mocks/react-native.ts'),
      '@react-navigation/native': path.resolve(
        __dirname,
        './node_modules/@react-navigation/native/lib/module/index.js',
      ),
      '@react-navigation/core': path.resolve(
        __dirname,
        './node_modules/@react-navigation/core/lib/module/index.js',
      ),
    },
  },
});
