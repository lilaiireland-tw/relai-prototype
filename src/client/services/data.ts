import { mockHome } from './mock'
import type { ClientDataService } from './types'
// Product APIs do not exist yet; all Home/cards/stats/settings data stays mock.
// Components depend on this contract, never fixtures or browser D1 bindings.
export const clientData: ClientDataService = {
 source: 'mock',
 async getHome() { return structuredClone(mockHome) },
 async listCards(type) { return structuredClone(mockHome.cards.filter(card => card.card_type === type)) },
}
