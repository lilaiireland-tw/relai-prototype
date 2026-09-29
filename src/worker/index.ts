import { Hono } from 'hono'
import { api } from './routes/api'
import type { AuthEnv } from './auth/types'

const apiBasePath = '/relaiapp/api/v1'
const apiPrefix = '/relaiapp/api'

export function createApp() {
  const app = new Hono<AuthEnv>()

  app.route(apiBasePath, api)

  app.notFound((c) => {
    if (c.req.path === apiPrefix || c.req.path.startsWith(`${apiPrefix}/`)) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }, 404)
    }

    // Cloudflare serves static assets and SPA navigation outside the API prefix.
    return new Response(null, { status: 404 })
  })

  app.onError((_error, c) =>
    c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' } }, 500),
  )

  return app
}

export default createApp()
