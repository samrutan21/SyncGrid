import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom provides DOMParser for the XML parser.
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
