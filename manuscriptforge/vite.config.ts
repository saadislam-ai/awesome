import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The desktop shell (Tauri) loads the dev server from a fixed port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  preview: { port: 1421, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 30000,
  },
});
