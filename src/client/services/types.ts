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
export interface HomeData {
 cards: Flashcard[]; today_reviews: number
 stats: { streak_days: number; total_reviews: number; total_cards_created: number }
 settings: { daily_goal: number; timezone: string }
}
export interface ClientDataService {
 getHome(): Promise<HomeData>
 listCards(type: Flashcard['card_type']): Promise<Flashcard[]>
}
