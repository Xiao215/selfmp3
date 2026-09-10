import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * In development the web app runs on 4601 and proxies `/api` to the server on
 * 4600, so the browser sees a single origin and there is no CORS to configure.
 * In production the server serves the built files itself and there is no proxy
 * at all.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4601,
    // Listen on all interfaces so the dev build can be opened from a phone.
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4600',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the vendor bundle so an app change does not invalidate React
        // in everyone's cache.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
})
