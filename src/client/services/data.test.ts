import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixtureHome } from '../testing/fixtures'
import { clientData } from './data'

afterEach(() => vi.unstubAllGlobals())
describe('authenticated data adapter', () => {
 it('loads every page and preserves nullable and arbitrary source metadata', async () => {
  const cards = fixtureHome.cards.slice(0, 3).map((card, index) => ({ ...card,
   source_item_id: index === 2 ? 'source-123' : null,
   source: index === 0 ? null : 'other_origin',
  }))
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
   const cursor = new URL(String(url), 'https://test.invalid').searchParams.get('cursor')
   return Response.json({ cards: cursor ? cards.slice(1) : cards.slice(0, 1), next_cursor: cursor ? null : 'next+cursor=' })
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await clientData.listCards('vocabulary')).toEqual(cards)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(new URL(String(fetcher.mock.calls[1][0]), 'https://test.invalid').searchParams.get('cursor')).toBe('next+cursor=')
 })
 it('rejects invalid or looping pagination without partial mock data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ cards: [], next_cursor: 'repeat' })))
  await expect(clientData.listCards()).rejects.toMatchObject({ kind: 'invalid-response' })
  expect(fetch).toHaveBeenCalledTimes(2)
 })
})
