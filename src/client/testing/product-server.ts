import { fixtureHome } from './fixtures'
import type { CardPatch, EnglishLevel, Flashcard, ReviewInput, Settings } from '../services/types'

// In-memory HTTP stand-in for component tests. API/repository tests use SQLite separately.
export function productServer() {
 const home = structuredClone(fixtureHome)
 const events = new Set<string>()
 function response(url: string, init?: RequestInit): Response {
  const path = new URL(url, 'https://example.test')
  const body = init?.body && !(init.body instanceof FormData) ? JSON.parse(String(init.body)) : {}
  if (path.pathname.endsWith('/vocabulary/image')) return Response.json({
   contract_version: 1,
   source_item_id: '00000000-0000-4000-8000-000000000001',
   suggestions: [
    { headword: 'curious', part_of_speech: 'adjective', semantic_sense: 'eager to know',
     source_context: 'She was curious about the old map.', confidence: 0.99 },
    { headword: 'map', part_of_speech: 'noun', semantic_sense: 'a representation of an area',
     source_context: 'The map showed the river.', confidence: 0.99 },
   ],
  })
  if (path.pathname.endsWith('/vocabulary/save')) {
   const selected = body.items as { headword: string; part_of_speech: string }[]
   const cards: Flashcard[] = []
   const results: { headword: string; status: 'saved'; card_id: string }[] = []
   for (const [index, item] of selected.entries()) {
    const content = item.headword === 'curious'
     ? { zh_tw_definition: '好奇的', english_example: 'She was curious about the old map.', zh_tw_example_translation: '她對那張舊地圖感到好奇。' }
     : { zh_tw_definition: '地圖', english_example: 'The map showed the river.', zh_tw_example_translation: '地圖標示了那條河。' }
    const card: Flashcard = {
    id: `00000000-0000-4000-8000-${String(home.cards.length + index + 1).padStart(12, '0')}`, user_id: 'owner', source_item_id: body.source_item_id,
    card_type: 'vocabulary', front_content: item.headword,
    back_content: `${content.zh_tw_definition}\n${content.english_example}\n${content.zh_tw_example_translation}`,
    part_of_speech: item.part_of_speech, ...content,
    explanation: null, irish_usage: null, source: 'Gemini image extraction', is_favorite: false,
    last_reviewed_at: null, next_review_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    cards.push(card)
    home.cards.unshift(card)
    results.push({ headword: item.headword, status: 'saved', card_id: card.id })
   }
   return Response.json({ results, cards })
  }
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
