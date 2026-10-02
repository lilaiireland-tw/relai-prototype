export interface Flashcard {
 id: string; user_id: string; source_item_id: string | null
 card_type: 'vocabulary' | 'error_log'
 front_content: string; back_content: string
 part_of_speech: string | null; zh_tw_definition: string | null
 explanation: string | null; irish_usage: string | null
 source: string | null; is_favorite: boolean
 last_reviewed_at: string | null; next_review_at: string | null
 created_at: string; updated_at: string
}
export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const
export type EnglishLevel = typeof ENGLISH_LEVELS[number]
export interface Settings {
 daily_goal: number; timezone: string; english_level: EnglishLevel | null
}
export interface StatsSummary {
 streak_days: number; longest_streak: number; total_cards: number
 total_cards_created: number; total_reviews: number; today_completed_reviews: number
 daily_goal: number; today_progress: number; daily_goal_completed: boolean
}
export interface HomeData { cards: Flashcard[]; stats: StatsSummary; settings: Settings }
export type CardFilter = 'all' | 'vocabulary' | 'error_log' | 'favorites' | 'needs_review'
export type CardPatch = Partial<Pick<Flashcard, 'front_content' | 'back_content' |
 'part_of_speech' | 'zh_tw_definition' | 'explanation' | 'irish_usage'>>
export interface ReviewInput { client_event_id: string; card_id: string; review_result: 'viewed' }
