import { z } from 'zod'

export const invalidInput = { error: { code: 'INVALID_INPUT', message: 'Invalid request.' } }
export const notFound = { error: { code: 'NOT_FOUND', message: 'Resource not found.' } }

export async function parseJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { return undefined }
}

export const id = z.string().min(1).max(128)
export const content = z.string().min(1).max(10000)
export const optionalContent = z.string().max(10000).nullable()

export function localDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function previousDate(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10)
}
