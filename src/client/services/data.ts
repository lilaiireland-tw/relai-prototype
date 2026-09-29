import { mockHome } from './mock'
import type { ClientDataService } from './types'
// Replace this adapter with same-origin Worker calls when APIs are assigned.
// Components depend on this contract, never fixtures or browser D1 bindings.
export const clientData: ClientDataService = {
 async getHome() { return structuredClone(mockHome) },
 async listCards(type) { return structuredClone(mockHome.cards.filter(card => card.card_type === type)) },
}
