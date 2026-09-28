import { Hono } from 'hono'
import { api } from './routes/api'

const apiBasePath = '/relaiapp/api/v1'

export function createApp() {
  const app = new Hono()

  app.route(apiBasePath, api)

  app.notFound((c) => {
    if (c.req.path === apiBasePath || c.req.path.startsWith(`${apiBasePath}/`)) {
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
