import { apiClient, ApiError } from '../lib/api'
import type { CardFilter, Flashcard, HomeData } from './types'

async function listCards(filter: CardFilter = 'all'): Promise<Flashcard[]> {
 const cards: Flashcard[] = []
 const seen = new Set<string>()
 let cursor: string | undefined
 do {
  const page = await apiClient.listCards(filter, cursor)
  cards.push(...page.cards)
  if (page.next_cursor === null) return cards
  if (seen.has(page.next_cursor)) throw new ApiError('invalid-response', '卡片分頁回應不正確，請重試。')
  seen.add(page.next_cursor)
  cursor = page.next_cursor
 } while (cursor)
 return cards
}
export const clientData = {
 source: 'api' as const,
 listCards,
 async getHome(): Promise<HomeData> {
  const [cards, stats, settings] = await Promise.all([listCards(), apiClient.getStats(), apiClient.getSettings()])
  return { cards, stats, settings }
 },
 getStats: apiClient.getStats,
 getSettings: apiClient.getSettings,
 updateSettings: apiClient.updateSettings,
 selectLevel: apiClient.selectLevel,
 updateCard: apiClient.updateCard,
 setFavorite: apiClient.setFavorite,
 deleteCard: apiClient.deleteCard,
 completeReview: apiClient.completeReview,
}
