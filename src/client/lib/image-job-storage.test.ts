import { afterEach, expect, it, vi } from 'vitest'
import { clearImageJobReference, imageJobIdempotencyKey, readImageJobReference, saveImageJobId } from './image-job-storage'

afterEach(() => vi.unstubAllGlobals())

it('keeps the client idempotency key and accepted job id across refreshes', () => {
 const values = new Map<string, string>()
 vi.stubGlobal('window', { localStorage: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
  removeItem: (key: string) => { values.delete(key) },
 } })

 const key = imageJobIdempotencyKey()
 expect(readImageJobReference()).toEqual({ key, id: null })
 expect(imageJobIdempotencyKey()).toBe(key)
 saveImageJobId('job-123')
 expect(readImageJobReference()).toEqual({ key, id: 'job-123' })
 clearImageJobReference()
 expect(readImageJobReference()).toEqual({ key: null, id: null })
})
