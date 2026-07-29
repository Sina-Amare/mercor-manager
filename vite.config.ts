import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const buildId = process.env.GITHUB_SHA ?? `local-${Date.now()}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
})
