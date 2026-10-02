import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import { clientData } from './data'
import { runtimeData } from './runtime'

afterEach(() => vi.unstubAllGlobals())

it('uses authenticated product APIs and never falls back to fixtures on failure', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', transport)
  expect(clientData.source).toBe('api')
  expect(runtimeData.source).toBe('api')
  await expect(clientData.getHome()).rejects.toMatchObject({ kind: 'network' })
  await expect(clientData.listCards('vocabulary')).rejects.toMatchObject({ kind: 'network' })
  await expect(clientData.listCards('error_log')).rejects.toMatchObject({ kind: 'network' })
  await expect(runtimeData.getHealth()).rejects.toMatchObject({ kind: 'network' })
  expect(transport.mock.calls.map(([url]) => url)).toContain('/relaiapp/api/v1/health')
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
      if (!path.includes(`${join('client', 'testing')}`)) {
        expect(text).not.toMatch(/from ['"].*(?:mock|testing|fixtures)/)
        expect(text).not.toMatch(/\bC[12]\b|模擬資料/)
      }
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
