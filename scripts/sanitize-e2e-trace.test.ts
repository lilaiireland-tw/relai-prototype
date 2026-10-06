import { expect, test } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { sanitizeTrace } from './sanitize-e2e-trace'

test('trace artifacts discard session traffic, request bodies, console logs and sources', () => {
  const zip = zipSync({
    '0.network': strToU8('Cookie: session-secret; Set-Cookie: session-secret'),
    'resources/body': strToU8('password-secret'),
    'resources/src@file.txt': strToU8('pepper-secret'),
    'resources/screen.jpeg': new Uint8Array([1, 2, 3]),
    '0.trace': strToU8('{"type":"console","text":"sensitive"}\n{"type":"before","apiName":"click"}\n'),
  })
  const sanitized = unzipSync(sanitizeTrace(zip))
  expect(strFromU8(sanitized['0.network'])).toBe('')
  expect(sanitized['resources/body']).toBeUndefined()
  expect(sanitized['resources/src@file.txt']).toBeUndefined()
  expect(sanitized['resources/screen.jpeg']).toEqual(new Uint8Array([1, 2, 3]))
  expect(strFromU8(sanitized['0.trace'])).toContain('click')
  expect(strFromU8(sanitized['0.trace'])).not.toContain('sensitive')
})
