import { test, expect, openCards } from './fixtures'

test('landing page → Login → real authenticated Home', async ({ page, login }) => {
  await page.goto('./')
  await page.getByRole('link', { name: '開始使用' }).click()
  await expect(page).toHaveURL(/\/relaiapp\/login$/)
  await login()
  await expect(page.getByText('你的學習進度', { exact: true })).toBeVisible()
})

test('protected direct navigation redirects; authenticated links retain basename', async ({ page, login }) => {
  await page.goto('cards')
  await expect(page).toHaveURL(/\/relaiapp\/login$/)
  await login()
  await openCards(page)
  await page.getByRole('link', { name: '返回首頁' }).click()
  await expect(page).toHaveURL(/\/relaiapp\/home$/)
})
