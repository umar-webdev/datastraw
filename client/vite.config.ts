import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, forward backend routes to the Bun server so the app behaves like the
// single-origin production deploy (cookies, no CORS).
const backend = 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/webhook': backend,
      '/health': backend,
    },
  },
})
