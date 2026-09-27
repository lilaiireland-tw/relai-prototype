import { Hono } from 'hono'

const app = new Hono()

app.get('/api/v1/health', (context) => context.json({ status: 'ok' }))

export default app
