import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'

export default defineConfig(({ mode, isPreview }) => {
  if (isPreview) {
    // Preview uses the flattened build configuration, which has no named environments.
    delete process.env.CLOUDFLARE_ENV
  } else {
    if (mode !== 'staging' && mode !== 'production') {
      throw new Error('Use the staging or production Vite mode to select D1 bindings.')
    }
    if (process.env.CLOUDFLARE_ENV && process.env.CLOUDFLARE_ENV !== mode) {
      throw new Error('CLOUDFLARE_ENV must match the selected Vite mode.')
    }
    // Cloudflare selects bindings at dev/build time, before emitting deploy config.
    process.env.CLOUDFLARE_ENV = mode
  }

  return {
    base: '/relaiapp/',
    plugins: [react(), cloudflare({ viteEnvironment: { name: 'relai_prototype' } })],
  }
})
