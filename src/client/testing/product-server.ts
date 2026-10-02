import { fixtureHome } from './fixtures'
import type { CardPatch, EnglishLevel, Flashcard, ReviewInput, Settings } from '../services/types'

// In-memory HTTP stand-in for component tests. API/repository tests use SQLite separately.
export function productServer() {
 const home = structuredClone(fixtureHome)
 const events = new Set<string>()
 function response(url: string, init?: RequestInit): Response {
  const path = new URL(url, 'https://example.test')
  const body = init?.body ? JSON.parse(String(init.body)) : {}
  if (path.pathname.endsWith('/settings')) {
   if (init?.method === 'PATCH') Object.assign(home.settings, body as Settings)
   return Response.json({ settings: home.settings })
  }
  if (path.pathname.endsWith('/onboarding/level')) {
   if (home.settings.english_level && home.settings.english_level !== body.english_level) return new Response(null, { status: 409 })
   const already = home.settings.english_level !== null
   home.settings.english_level = body.english_level as EnglishLevel
   return Response.json({ english_level: home.settings.english_level, starter_cards_created: already ? 0 : home.cards.length, already_selected: already })
  }
  if (path.pathname.endsWith('/stats/summary')) return Response.json({ ...home.stats, daily_goal: home.settings.daily_goal, total_cards: home.cards.length })
  if (path.pathname.endsWith('/reviews')) {
   const input = body as ReviewInput
   const duplicate = events.has(input.client_event_id)
   if (!duplicate) {
    events.add(input.client_event_id)
    home.stats.total_reviews++; home.stats.today_completed_reviews++
    home.stats.today_progress = Math.min(home.stats.today_completed_reviews, home.settings.daily_goal)
    const card = home.cards.find(card => card.id === input.card_id)!
    card.last_reviewed_at = new Date().toISOString()
   }
   return Response.json({ completed: true, already_completed: duplicate })
  }
  if (path.pathname.endsWith('/cards')) {
   let cards = home.cards
   const type = path.searchParams.get('card_type')
   if (type) cards = cards.filter(card => card.card_type === type)
   if (path.searchParams.get('favorite') === 'true') cards = cards.filter(card => card.is_favorite)
   if (path.searchParams.get('needs_review') === 'true') cards = cards.filter(card => !card.last_reviewed_at || Date.parse(card.last_reviewed_at) < Date.now() - 7 * 86400000)
   return Response.json({ cards, next_cursor: null })
  }
  const match = path.pathname.match(/\/cards\/([^/]+)(\/favorite)?$/)
  if (match) {
   const card = home.cards.find(card => card.id === decodeURIComponent(match[1]))
   if (!card) return new Response(null, { status: 404 })
   if (init?.method === 'DELETE') { home.cards = home.cards.filter(item => item.id !== card.id); return new Response(null, { status: 204 }) }
   if (match[2]) card.is_favorite = (body as Flashcard).is_favorite ?? body.favorite
   else if (init?.method === 'PATCH') Object.assign(card, body as CardPatch)
   return Response.json({ card })
  }
  return Response.json({ status: 'ok' })
 }
 return { home, events, response }
}
