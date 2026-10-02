import { Hono } from 'hono'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { createRepositories } from '../persistence'
import { localDate } from './product-utils'

export const stats = new Hono<AuthEnv>()
stats.use('*', requireAuth, requirePasswordChanged)
stats.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

stats.get('/summary', async (c) => {
  const userId = c.get('user').id
  const repos = createRepositories(c.env.DB)
  const now = new Date()
  const at = now.toISOString()
  const settings = await repos.userSettings.getOrCreate(userId, 'UTC', at)
  const state = await repos.userStats.getOrCreate(userId, at)
  const day = localDate(now, settings.timezone)
  // Every IANA local day lies within this finite UTC window, including UTC+14 and UTC-12.
  const utcMidnight = Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`)
  const timestamps = await repos.reviewEvents.timestampsInRange(userId,
    new Date(utcMidnight - 86400000).toISOString(), new Date(utcMidnight + 2 * 86400000).toISOString())
  const todayCompletedReviews = timestamps.filter(timestamp =>
    localDate(new Date(timestamp), settings.timezone) === day).length
  const totalCards = await repos.flashcards.count(userId)
  const streakDays = state.last_active_date === day || state.last_active_date ===
    new Date(Date.parse(`${day}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10)
    ? state.streak_days : 0
  return c.json({ streak_days: streakDays, longest_streak: state.longest_streak,
    total_cards: totalCards, total_cards_created: state.total_cards_created,
    total_reviews: state.total_reviews, today_completed_reviews: todayCompletedReviews,
    daily_goal: settings.daily_goal, today_progress: Math.min(todayCompletedReviews, settings.daily_goal),
    daily_goal_completed: todayCompletedReviews >= settings.daily_goal })
})
