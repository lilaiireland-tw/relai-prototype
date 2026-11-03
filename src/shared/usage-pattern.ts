import { z } from 'zod'

export const usagePatternSchema = z.strictObject({
  pattern: z.string().trim().min(1).max(160),
  zh_tw_explanation: z.string().trim().min(1).max(300),
  example: z.string().trim().min(1).max(500),
  zh_tw_example_translation: z.string().trim().min(1).max(500),
})
export const usagePatternsSchema = z.array(usagePatternSchema).max(2)
export type UsagePattern = z.infer<typeof usagePatternSchema>

export function parseUsagePatterns(value: string | null | undefined): UsagePattern[] {
  try { return usagePatternsSchema.parse(JSON.parse(value ?? '[]')) }
  catch { return [] }
}
