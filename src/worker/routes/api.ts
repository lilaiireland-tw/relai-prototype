import { Hono } from 'hono'
import { health } from './health'
import { auth } from './auth'
import type { AuthEnv } from '../auth/types'

export const api = new Hono<AuthEnv>()

api.route('/health', health)
api.route('/auth', auth)
