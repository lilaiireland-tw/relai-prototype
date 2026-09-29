import { describe, expect, it, vi } from 'vitest'
import type { Flashcard } from './types'
import { clientData } from './data'

vi.mock('./mock', async (importOriginal) => {
  const { mockHome } = await importOriginal<typeof import('./mock')>()
  // Typed fixtures make typecheck catch accidental narrowing of the contract.
  // Exercise the real adapter with nullable and open-ended source metadata.
  const cards: Flashcard[] = [
    { ...mockHome.cards[0], id: 'nullable-source', source_item_id: null, source: null },
    { ...mockHome.cards[1], id: 'other-source', source_item_id: null, source: 'imported_notes' },
    { ...mockHome.cards[2], id: 'linked-source', source_item_id: 'source-123', source: 'other_origin' },
  ]
  return { mockHome: { ...mockHome, cards } }
})

describe('client data source metadata compatibility', () => {
  it('preserves nullable and arbitrary source values through both service methods', async () => {
    const expected = [
      { id: 'nullable-source', source_item_id: null, source: null },
      { id: 'other-source', source_item_id: null, source: 'imported_notes' },
      { id: 'linked-source', source_item_id: 'source-123', source: 'other_origin' },
    ]
    const home = await clientData.getHome()
    const cards = await clientData.listCards('vocabulary')
    for (const result of [home.cards, cards]) {
      expect(result.map(({ id, source_item_id, source }) => ({ id, source_item_id, source }))).toEqual(expected)
    }
  })
})
