import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
  },
  worker: {
    format: 'iife',
  },
  server: {
    port: 5173,
    open: true
  }
})
