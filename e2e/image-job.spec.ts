import { test, expect } from './fixtures'

test('restores a recognized job with no saved cards as an explicit failure', async ({ page, login }) => {
  await page.goto('login')
  await login()
  await page.evaluate(() => localStorage.setItem('relai.image-job.id', '00000000-0000-4000-8000-000000000101'))
  await page.route('**/api/v1/vocabulary/image-jobs/00000000-0000-4000-8000-000000000101', route => route.fulfill({ json: {
    job_id: '00000000-0000-4000-8000-000000000101', status: 'failed', stage: 'failed', error_code: 'NO_CARDS_SAVED',
    suggestions: [{ headword: 'map', part_of_speech: 'noun', semantic_sense: 'a drawing of an area',
      source_context: 'Read the map.', confidence: 0.99 }],
    results: [{ headword: 'map', status: 'not_saved', reason: 'invalid_content' }], cards: [],
  } }))
  await page.goto('capture')
  await expect(page.getByRole('status')).toContainText('已辨識圖片，但沒有可儲存的單字卡。')
  await expect(page.getByRole('status')).toContainText('1 個項目無法建立')
  await expect(page.getByText('map', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '辨識並建立單字卡' })).toBeDisabled()
})


test('discovers another device session, locks uploads, and reconnects to persisted completion', async ({ page, login }) => {
  await page.goto('login')
  await login()
  const id = '00000000-0000-4000-8000-000000000103'
  let completed = false
  let uploads = 0
  let saves = 0
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/vocabulary/image-jobs')) uploads++
    if (request.method() === 'POST' && request.url().endsWith('/vocabulary/save')) saves++
  })
  await page.route('**/api/v1/vocabulary/image-jobs/current', route => completed
    ? route.fulfill({ status: 404, json: { error: { code: 'IMAGE_JOB_NOT_FOUND' } } })
    : route.fulfill({ json: { job_id: id, status: 'queued', stage: 'queued', error_code: null } }))
  await page.route('**/api/v1/vocabulary/image-jobs/' + id, route => route.fulfill({ json: completed
    ? { job_id: id, status: 'completed', stage: 'completed', error_code: null, suggestions: [], results: [], cards: [] }
    : { job_id: id, status: 'queued', stage: 'queued', error_code: null } }))
  await page.goto('capture')
  await expect(page.getByRole('button', { name: 'Abandon current job' })).toBeVisible()
  for (const input of await page.locator('input[type=file]').all()) await expect(input).toBeDisabled()
  completed = true
  await page.reload()
  for (const input of await page.locator('input[type=file]').all()) await expect(input).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Abandon current job' })).toHaveCount(0)
  expect(uploads).toBe(0)
  expect(saves).toBe(0)
})
