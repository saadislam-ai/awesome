import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The interface is plain static files once built: nothing is loaded from the internet at run time.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
  // The grammar checker finds its WebAssembly file next to its own code. Left as it is (not pre-bundled),
  // that file is found during development as well as in the built app.
  optimizeDeps: { exclude: ['harper.js'] },
});
