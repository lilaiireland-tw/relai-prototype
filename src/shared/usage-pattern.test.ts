import { describe, expect, it } from 'vitest'
import { parseUsagePatterns, usagePatternsSchema } from './usage-pattern'

const pattern = { pattern: 'be used to + V-ing', zh_tw_explanation: '習慣於做……',
  example: 'She is used to getting up early.', zh_tw_example_translation: '她習慣早起。' }

describe('canonical usage patterns', () => {
  it('accepts zero, one, or two patterns and rejects a third', () => {
    expect(usagePatternsSchema.safeParse([]).success).toBe(true)
    expect(usagePatternsSchema.safeParse([pattern]).success).toBe(true)
    expect(usagePatternsSchema.safeParse([pattern, pattern]).success).toBe(true)
    expect(usagePatternsSchema.safeParse([pattern, pattern, pattern]).success).toBe(false)
  })

  it('parses safely escaped JSON and defaults legacy empty or invalid content', () => {
    expect(parseUsagePatterns(JSON.stringify([{ ...pattern, zh_tw_explanation: '習慣於「做……」' }]))[0])
      .toMatchObject({ zh_tw_explanation: '習慣於「做……」' })
    expect(parseUsagePatterns(null)).toEqual([])
    expect(parseUsagePatterns('{broken')).toEqual([])
  })
})
