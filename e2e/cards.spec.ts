import { test, expect, openCards } from './fixtures'

test.beforeEach(async ({ page, login }) => {
  await page.goto('login')
  await login()
  await openCards(page)
})

test('real local D1 cards can advance and flip', async ({ page }) => {
  await page.getByRole('button', { name: '下一張' }).click()
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'book', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '翻面' }).click()
  await expect(page.getByRole('button', { name: '翻面' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('paragraph').filter({ hasText: 'This is a book.' })).toBeVisible()
})

test('#80: real tab focus revalidation preserves position, filter, flip and protected DOM', async ({ page, context }) => {
  await page.getByRole('combobox', { name: '篩選卡片' }).selectOption('needs_review')
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一張' }).click()
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '翻面' }).click()
  const original = await page.getByRole('button', { name: '翻面' }).elementHandle()
  if (!original) throw new Error('Flip button missing')
  // Observe removal of protected content, including a transient loading/remount.
  await original.evaluate(node => {
    const observer = new MutationObserver(() => {
      if (!node.isConnected) document.documentElement.setAttribute('data-e2e-remounted', 'true')
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  const other = await context.newPage()
  await other.goto('about:blank')
  // Playwright enables Chromium's always-focused emulation by default.
  // Disable that override so tab activation drives the browser's real lifecycle.
  const appSession = await context.newCDPSession(page)
  const otherSession = await context.newCDPSession(other)
  await appSession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await otherSession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await other.bringToFront()
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
  const revalidated = page.waitForResponse(r => r.url().endsWith('/api/v1/auth/me') && r.request().method() === 'GET')
  await page.bringToFront()
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  expect((await revalidated).status()).toBe(200)
  // Wait for the application's response handler to run before testing preserved state.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '篩選卡片' })).toHaveValue('needs_review')
  await expect(page.getByRole('button', { name: '翻面' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('paragraph').filter({ hasText: 'This is a book.' })).toBeVisible()
  expect(await original.evaluate(node => node.isConnected)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-e2e-remounted'))).toBe(false)
  await other.close()
  await appSession.detach()
})
