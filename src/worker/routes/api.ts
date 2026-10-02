import { Hono } from 'hono'
import { health } from './health'
import { auth } from './auth'
import { onboarding } from './onboarding'
import { cards } from './cards'
import { reviews } from './reviews'
import { stats } from './stats'
import { settings } from './settings'
import type { AuthEnv } from '../auth/types'

export const api = new Hono<AuthEnv>()

api.route('/health', health)
api.route('/auth', auth)
api.route('/onboarding', onboarding)
api.route('/cards', cards)
api.route('/reviews', reviews)
api.route('/stats', stats)
api.route('/settings', settings)
