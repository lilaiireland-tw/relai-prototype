import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Independent from deployment configs; no staging/production environment selection.
export default defineConfig({
  base: '/relaiapp/',
  envDir: 'e2e',
  plugins: [react(), cloudflare({
    configPath: 'e2e/wrangler.jsonc',
    persistState: { path: '.wrangler/e2e' },
    remoteBindings: false,
    viteEnvironment: { name: 'relai_prototype' },
  })],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
})
