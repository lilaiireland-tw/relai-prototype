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
