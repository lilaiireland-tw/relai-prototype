import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
import { e2eUser } from '../scripts/e2e-data'
import { sanitizeTrace } from '../scripts/sanitize-e2e-trace'
import { resetE2EState } from '../scripts/setup-e2e'

export const test = base.extend<{ login: () => Promise<void>; resetData: void }>({
  // Playwright requires destructured fixture arguments, even when none are needed.
  // eslint-disable-next-line no-empty-pattern
  resetData: [async ({}, use) => { resetE2EState(); await use() }, { auto: true }],
  login: async ({ page, context }, use, testInfo) => {
    let tracing = false
    await use(async () => {
      await page.getByLabel('使用者名稱').fill(e2eUser.username)
      await page.getByLabel('密碼', { exact: true }).fill(e2eUser.password)
      await page.getByRole('button', { name: '登入並開始' }).click()
      await expect(page).toHaveURL(/\/relaiapp\/home$/)
      await expect(page.getByText('Local E2E Learner', { exact: true })).toBeVisible()
      // Credentials and login traffic are never recorded. Failure screenshots mask inputs.
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
      tracing = true
    })
    if (tracing) {
      const raw = testInfo.outputPath('raw-trace.zip')
      try {
        await context.tracing.stop({ path: raw })
        if (testInfo.status !== testInfo.expectedStatus) {
          const trace = testInfo.outputPath('trace.zip')
          writeFileSync(trace, sanitizeTrace(readFileSync(raw)))
          await testInfo.attach('trace', { path: trace, contentType: 'application/zip' })
        }
      } finally { rmSync(raw, { force: true }) }
    }
  },
})
export { expect }

export async function openCards(page: Page) {
  const response = page.waitForResponse(r => r.url().includes('/api/v1/cards') && r.request().method() === 'GET')
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('link', { name: '單字卡', exact: true }).click()
  expect((await response).status()).toBe(200)
  await expect(page).toHaveURL(/\/relaiapp\/cards$/)
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'apple', exact: true })).toBeVisible()
}
