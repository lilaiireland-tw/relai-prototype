import { test, expect } from './fixtures'

for (const hasAmbiguousWord of [false, true]) {
test(`restores a zero-card failure (ambiguous word: ${hasAmbiguousWord})`, async ({ page, login }) => {
  await page.goto('login')
  await login()
  await page.evaluate(() => localStorage.clear())
  const ambiguousItem = { headword: 'curious', part_of_speech: 'adjective', semantic_sense: 'eager to know',
    source_context: 'She is curious.', confidence: 0.5 }
  await page.route('**/api/v1/vocabulary/image-jobs/latest', route => route.fulfill({ json: {
    job_id: '00000000-0000-4000-8000-000000000101', status: 'failed', stage: 'failed', error_code: 'NO_CARDS_SAVED',
    suggestions: [{ headword: 'map', part_of_speech: 'noun', semantic_sense: 'a drawing of an area',
      source_context: 'Read the map.', confidence: 0.99 }, ...(hasAmbiguousWord ? [ambiguousItem] : [])],
    results: [{ headword: 'map', status: 'not_saved', reason: 'invalid_content' }, ...(hasAmbiguousWord ? [{
      headword: 'curious', status: 'ambiguous', reason: 'low_confidence',
      item: ambiguousItem, options: [{ catalog_id: 'legacy-sense', semantic_sense: 'eager to know' }],
    }] : [])], cards: [],
  } }))
  await page.goto('capture')
  await expect(page.getByRole('status')).toContainText('已辨識圖片，但沒有可儲存的單字卡。')
  await expect(page.getByRole('status')).toContainText('1 個項目無法建立')
  await expect(page.getByRole('status')).toContainText(`${hasAmbiguousWord ? 1 : 0} 個項目已跳過`)
  await expect(page.getByText(/需要確認|無法安全判斷|使用「/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '辨識並建立單字卡' })).toBeDisabled()
})
}

for (const [outcome, message] of [
  ['no_english', '無法辨識英文內容，ReLai 目前僅支援英文單字學習'],
  ['unreadable', '無法清楚辨識文字，請重新拍攝清晰圖片。'],
  ['no_new_words', '目前沒有新的推薦單字。'],
  ['no_reliable_words', '沒有可可靠建立的英文單字卡。'],
]) {
  test(`restores normal empty outcome ${outcome} without confirmation or save requests`, async ({ page, login }) => {
    await page.goto('login')
    await login()
    let saves = 0
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/vocabulary/save')) saves++ })
    await page.route('**/api/v1/vocabulary/image-jobs/latest', route => route.fulfill({ json: {
      job_id: '00000000-0000-4000-8000-000000000105', status: 'completed', stage: 'completed', error_code: null,
      outcome, suggestions: [], results: [], cards: [],
    } }))
    await page.goto('capture')
    await expect(page.getByRole('status')).toContainText(message)
    await page.reload()
    await expect(page.getByRole('status')).toContainText(message)
    await expect(page.getByRole('navigation', { name: '新建單字卡' })).toHaveCount(0)
    await expect(page.getByText(/需要確認|無法安全判斷|使用「/)).toHaveCount(0)
    expect(saves).toBe(0)
  })
}

test('shows six automatically saved cards and four skipped candidates after refresh', async ({ page, login }) => {
  await page.goto('login')
  await login()
  const { cards: fixtures } = await (await page.request.get('/relaiapp/api/v1/cards')).json()
  const cards = Array.from({ length: 6 }, (_, index) => ({ ...fixtures[0],
    id: `00000000-0000-4000-8000-00000000000${index}`, front_content: `word${index}` }))
  await page.route('**/api/v1/vocabulary/image-jobs/latest', route => route.fulfill({ json: {
    job_id: '00000000-0000-4000-8000-000000000106', status: 'completed', stage: 'completed', error_code: null,
    outcome: 'partial', results: [
      ...cards.map(card => ({ headword: card.front_content, status: 'saved', card_id: card.id })),
      ...Array.from({ length: 4 }, (_, index) => ({ headword: `skip${index}`, status: 'skipped', reason: 'insufficient_context' })),
    ], cards,
  } }))
  await page.goto('capture')
  await page.reload()
  await expect(page.getByRole('status')).toContainText('已建立 6 張單字卡')
  await expect(page.getByRole('status')).toContainText('4 個項目已跳過')
  await expect(page.getByRole('navigation', { name: '新建單字卡' }).getByRole('link')).toHaveCount(6)
  await expect(page.getByText(/需要確認|無法安全判斷|使用「/)).toHaveCount(0)
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
  await page.route('**/api/v1/vocabulary/image-jobs/latest', route => route.fulfill({ json: completed
    ? { job_id: id, status: 'completed', stage: 'completed', error_code: null, suggestions: [], results: [], cards: [] }
    : { job_id: id, status: 'queued', stage: 'queued', error_code: null } }))
  await page.route('**/api/v1/vocabulary/image-jobs/' + id, route => route.fulfill({ json: completed
    ? { job_id: id, status: 'completed', stage: 'completed', error_code: null, suggestions: [], results: [], cards: [] }
    : { job_id: id, status: 'queued', stage: 'queued', error_code: null } }))
  await page.evaluate(() => localStorage.clear())
  await page.goto('capture')
  await expect(page.getByRole('button', { name: 'Abandon current job' })).toBeVisible()
  for (const input of await page.locator('input[type=file]').all()) await expect(input).toBeDisabled()
  completed = true
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  for (const input of await page.locator('input[type=file]').all()) await expect(input).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Abandon current job' })).toHaveCount(0)
  expect(uploads).toBe(0)
  expect(saves).toBe(0)
})


test('no previous job leaves the initial upload state empty', async ({ page, login }) => {
  await page.goto('login')
  await login()
  await page.evaluate(() => localStorage.clear())
  await page.goto('capture')
  for (const input of await page.locator('input[type=file]').all()) await expect(input).toBeEnabled()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Abandon current job' })).toHaveCount(0)
})

test('discovers an abandoned job without storage and permits a new photo', async ({ page, login }) => {
  await page.goto('login')
  await login()
  await page.evaluate(() => localStorage.clear())
  await page.route('**/api/v1/vocabulary/image-jobs/latest', route => route.fulfill({ json: {
    job_id: '00000000-0000-4000-8000-000000000104', status: 'failed', stage: 'abandoned', error_code: 'IMAGE_JOB_ABANDONED',
  } }))
  await page.goto('capture')
  await expect(page.getByRole('status')).toContainText('Image job abandoned.')
  for (const input of await page.locator('input[type=file]').all()) await expect(input).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Abandon current job' })).toHaveCount(0)
})
