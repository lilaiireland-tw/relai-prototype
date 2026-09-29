import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import { clientData } from './data'
import { runtimeData } from './runtime'

afterEach(() => vi.unstubAllGlobals())

it('keeps product datasets mock and independent of health transport', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', transport)
  expect(clientData.source).toBe('mock')
  expect(runtimeData.source).toBe('api')
  const home = await clientData.getHome()
  expect(home.cards.length).toBeGreaterThan(0)
  expect(home.stats.total_reviews).toBeGreaterThan(0)
  expect(home.settings.daily_goal).toBe(10)
  expect(await clientData.listCards('vocabulary')).toEqual(home.cards.filter(card => card.card_type === 'vocabulary'))
  expect(await clientData.listCards('error_log')).toEqual(home.cards.filter(card => card.card_type === 'error_log'))
  expect(transport).not.toHaveBeenCalled()
  await expect(runtimeData.getHealth()).rejects.toMatchObject({ kind: 'network' })
  expect(transport).toHaveBeenCalledTimes(1)
  expect(transport.mock.calls[0][0]).toBe('/relaiapp/api/v1/health')
  expect(await clientData.getHome()).toEqual(home)
  expect(transport).toHaveBeenCalledTimes(1)
})

it('centralizes all client fetch calls in the API module, never components or pages', () => {
  const clientRoot = join(process.cwd(), 'src/client')
  const callers: string[] = []
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { inspect(path); continue }
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue
      const text = readFileSync(path, 'utf8')
      expect(text).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|\bBearer\b|\bJWT\b|Authorization/)
      expect(text).not.toMatch(/DemoSession/)
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const callee = node.expression
          if ((ts.isIdentifier(callee) && callee.text === 'fetch') ||
            (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch') ||
            (ts.isElementAccessExpression(callee) && callee.argumentExpression && ts.isStringLiteral(callee.argumentExpression) && callee.argumentExpression.text === 'fetch')) {
            callers.push(path)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  inspect(clientRoot)
  expect([...new Set(callers)]).toEqual([join(clientRoot, 'lib/api.ts')])
})
