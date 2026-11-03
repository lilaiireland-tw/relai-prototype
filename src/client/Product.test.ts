// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from './App'
import { productServer } from './testing/product-server'

describe('Phase 4 authenticated product UI', () => {
 let container: HTMLDivElement
 let root: Root
 let server: ReturnType<typeof productServer>
 let mustChange: boolean
 beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubEnv('BASE_URL', '/relaiapp/')
  mustChange = false
  window.localStorage.clear()
  server = productServer()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
   if (String(url).endsWith('/auth/me')) return Response.json({ user: { id: 'owner', username: 'Alex', display_name: 'Alex', role: 'user', must_change_password: mustChange } })
   return server.response(String(url), init)
  }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
 })
 afterEach(async () => {
  await act(() => root.unmount()); container.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
 })
 async function renderAt(path: string) {
  window.history.replaceState(null, '', `/relaiapp/${path}`)
  await act(() => root.render(createElement(AppRouter)))
 }
 async function refreshAt(path: string) {
  await act(() => root.unmount()); root = createRoot(container); await renderAt(path)
 }
 function button(text: string) { return [...container.querySelectorAll('button')].find(el => el.textContent?.trim() === text)! }
 async function click(element: Element) { expect(element).toBeTruthy(); await act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
 async function submit() { await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
 async function change(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)!
  expect(field).toBeTruthy()
  await act(() => {
   const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
   Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value)
   field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
 }
 const requests = (suffix: string, method?: string) => vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).split('?')[0].endsWith(suffix) && (!method || init?.method === method))

 it.each(['success', 'network', '503'] as const)('preserves mounted card position, filter and flip during %s focus revalidation', async outcome => {
  const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
  await renderAt('cards')
  await click(button('下一張')); await click(button('翻面'))
  const card = container.querySelector('.flip-card-inner')
  const filter = container.querySelector<HTMLSelectElement>('select[aria-label="篩選卡片"]')!
  const content = container.textContent
  const settingsReads = requests('/settings').length
  const cardsReads = requests('/cards').length
  const authReads = requests('/auth/me').length
  let resolveMe!: (response: Response) => void
  let rejectMe!: (error: Error) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve, reject) => { resolveMe = resolve; rejectMe = reject }))
  await act(() => window.dispatchEvent(new Event('blur')))
  await act(() => window.dispatchEvent(new Event('focus')))
  const expectPreserved = () => {
   expect(window.location.pathname).toBe('/relaiapp/cards')
   expect(container.textContent).toBe(content)
   expect(container.textContent).toContain('2 / 4')
   expect(container.querySelector('.flip-card-inner')).toBe(card)
   expect(card?.classList.contains('flipped')).toBe(true)
   expect(button('翻面').getAttribute('aria-pressed')).toBe('true')
   expect(container.querySelector('select[aria-label="篩選卡片"]')).toBe(filter)
   expect(filter.value).toBe('vocabulary')
   expect(requests('/settings')).toHaveLength(settingsReads)
   expect(requests('/cards')).toHaveLength(cardsReads)
   expect(storageSpy).not.toHaveBeenCalled()
  }
  expect(requests('/auth/me')).toHaveLength(authReads + 1)
  expectPreserved()
  await act(() => {
   if (outcome === 'network') rejectMe(new Error('private network detail'))
   else resolveMe(outcome === '503' ? new Response('private server detail', { status: 503 }) : Response.json({
    user: { id: 'owner', username: 'Alex', display_name: 'Updated Alex', role: 'user', must_change_password: false },
   }))
  })
  expectPreserved()
  if (outcome !== 'success') {
   // A transient auth failure does not bypass later centralized product 401 handling.
   vi.mocked(fetch).mockImplementationOnce(async () => new Response(null, { status: 401 }))
   await click(button('收藏'))
   expect(window.location.pathname).toBe('/relaiapp/login')
   expect(container.querySelector('.flip-card-inner')).toBeNull()
  } else {
   await click(button('下一張'))
   expect(container.textContent).toContain('3 / 4')
  }
 })
 it('hides Cards and redirects to login when background focus revalidation returns 401', async () => {
  await renderAt('cards'); await click(button('下一張'))
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(null, { status: 401 }))
  await act(() => window.dispatchEvent(new Event('focus')))
  expect(window.location.pathname).toBe('/relaiapp/login')
  expect(container.querySelector('[data-source="api"]')).toBeNull()
  expect(container.querySelector('select[aria-label="篩選卡片"]')).toBeNull()
  expect(requests('/auth/me')).toHaveLength(2)
 })
 it('still enforces password requirements returned by background focus revalidation', async () => {
  await renderAt('cards')
  mustChange = true
  await act(() => window.dispatchEvent(new Event('focus')))
  expect(window.location.pathname).toBe('/relaiapp/change-password')
  expect(container.querySelector('[data-source="api"]')).toBeNull()
  expect(requests('/settings')).toHaveLength(1)
  expect(requests('/cards')).toHaveLength(1)
 })

 it.each(['home', 'cards', 'cards/vocab-1', 'vocabulary', 'capture', 'error-log', 'stats', 'settings'])('gates no-level %s before loading product screens', async path => {
  server.home.settings.english_level = null
  await renderAt(path)
  expect(window.location.pathname).toBe('/relaiapp/onboarding')
  expect([...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(input => input.value)).toEqual(['A1', 'A2', 'B1', 'B2'])
  expect(container.textContent).toContain('CEFR-J')
  expect(requests('/cards')).toHaveLength(0); expect(requests('/stats/summary')).toHaveLength(0)
  expect(container.querySelector('[data-source="mock"]')).toBeNull()
 })
 it.each(['A1', 'A2', 'B1', 'B2'])('submits only %s to starter bootstrap and shows persisted cards after refresh', async level => {
  server.home.settings.english_level = null
  await renderAt('cards')
  await click(container.querySelector(`input[value="${level}"]`)!)
  await submit()
  expect(requests('/onboarding/level', 'POST')[0][1]?.body).toBe(JSON.stringify({ english_level: level }))
  expect(window.location.pathname).toBe('/relaiapp/home')
  expect(container.textContent).toContain('serendipity')
  await refreshAt('home')
  expect(container.textContent).toContain('今日進度')
  expect(requests('/onboarding/level')).toHaveLength(1)
 })

 it('submits a durable image job, polls persisted results and links directly to the created cards', async () => {
  await renderAt('capture')
  const input = container.querySelector<HTMLInputElement>('input[type="file"][aria-label="從裝置選擇照片"]')!
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'lesson.png', { type: 'image/png' })
  await act(() => {
   Object.defineProperty(input, 'files', { configurable: true, value: [file] })
   input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click(button('辨識並建立單字卡'))
  expect(container.textContent).toContain('She was curious about the old map.')
  const uploadCall = requests('/vocabulary/image-jobs', 'POST')[0][1]!
  expect(uploadCall.body).toBeInstanceOf(FormData)
  expect(new Headers(uploadCall.headers).has('Content-Type')).toBe(false)
  expect(new Headers(uploadCall.headers).get('Idempotency-Key')).toMatch(/^[\da-f-]{36}$/i)
  expect(requests('/vocabulary/image-jobs/00000000-0000-4000-8000-000000000001')).toHaveLength(1)
  expect(requests('/vocabulary/save', 'POST')).toHaveLength(0)
  expect(container.textContent).toContain('已建立 2 張單字卡')
  const link = container.querySelector<HTMLAnchorElement>('a[href^="/relaiapp/cards/"]')!
  expect(link).toBeTruthy()
  expect(link.textContent).toContain('curious')
  await click(link)
  expect(window.location.pathname).toContain('/cards/')
  expect(container.textContent).toContain('curious')
 })
 it('recovers the durable job by idempotency key when the upload response is lost', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  let idempotencyKey = ''
  vi.mocked(fetch).mockImplementation(async (url, init) => {
   const path = new URL(String(url), 'https://example.test').pathname
   if (path.endsWith('/vocabulary/image-jobs') && init?.method === 'POST') {
    idempotencyKey = new Headers(init.headers).get('Idempotency-Key') ?? ''
    throw new TypeError('connection lost after upload')
   }
   if (path.includes('/vocabulary/image-jobs/by-key/')) return server.response(String(url), init)
   return originalFetch(url, init)
  })
  await renderAt('capture')
  const input = container.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!
  await act(() => {
   Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'lesson.png', { type: 'image/png' })] })
   input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await submit()
  expect(idempotencyKey).toMatch(/^[\da-f-]{36}$/i)
  expect(requests('/vocabulary/image-jobs', 'POST')).toHaveLength(1)
  expect(requests('/vocabulary/image-jobs/by-key/' + idempotencyKey)).toHaveLength(1)
  expect(requests('/vocabulary/save', 'POST')).toHaveLength(0)
  expect(container.textContent).toContain('curious')
  await refreshAt('capture')
  expect(requests('/vocabulary/image-jobs', 'POST')).toHaveLength(1)
  expect(requests('/vocabulary/image-jobs/by-key/' + idempotencyKey)).toHaveLength(1)
  expect(requests('/vocabulary/image-jobs/00000000-0000-4000-8000-000000000001')).toHaveLength(1)
 })
 it('lets the user resolve an ambiguous catalog sense', async () => {
  const sourceId = '00000000-0000-4000-8000-000000000099'
  const cardId = '00000000-0000-4000-8000-000000000098'
  const ambiguous = { headword: 'bank', status: 'ambiguous', reason: 'ambiguous_sense',
   item: { headword: 'bank', part_of_speech: 'noun', semantic_sense: 'land beside water',
    source_context: 'They walked beside the bank.', confidence: 0.99 },
   options: [{ catalog_id: '00000000-0000-4000-8000-000000000097', semantic_sense: 'land beside a river' }] }
  const card = { id: cardId, user_id: 'owner', source_item_id: sourceId, card_type: 'vocabulary',
   front_content: 'bank', back_content: 'river edge', part_of_speech: 'noun', zh_tw_definition: '河岸',
   english_example: 'They walked along the bank.', zh_tw_example_translation: '他們沿著河岸走。',
   explanation: null, irish_usage: null, source: 'Gemini image extraction', is_favorite: false,
   last_reviewed_at: null, next_review_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  const fallback = server.response
  server.response = (url, init) => {
   const path = new URL(url, 'https://example.test').pathname
   if (path.endsWith('/vocabulary/image-jobs') && init?.method === 'POST') return Response.json({ job_id: sourceId, status: 'queued',
    quota: { limit: 5, used: 1, remaining: 4, resets_at: '2027-01-03T00:00:00.000Z' } }, { status: 202 })
   if (path.endsWith(`/vocabulary/image-jobs/${sourceId}`)) return Response.json({ job_id: sourceId, status: 'completed',
    stage: 'completed', error_code: null, suggestions: [ambiguous.item], results: [ambiguous], cards: [] })
   if (path.endsWith('/vocabulary/save')) {
    const items = JSON.parse(String(init?.body)).items as { semantic_sense: string }[]
    return items[0].semantic_sense === 'land beside a river'
     ? Response.json({ results: [{ headword: 'bank', status: 'saved', card_id: cardId }], cards: [card] })
     : Response.json({ results: [ambiguous], cards: [] })
   }
   return fallback(url, init)
  }
  await renderAt('capture')
  const input = container.querySelector<HTMLInputElement>('input[type="file"][aria-label="從裝置選擇照片"]')!
  await act(() => {
   Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'lesson.png', { type: 'image/png' })] })
   input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click(button('辨識並建立單字卡'))
  expect(requests('/vocabulary/save', 'POST')).toHaveLength(0)
  expect(container.textContent).toContain('無法安全判斷「bank」的詞義')
  await click(button('使用「land beside a river」'))
  expect(requests('/vocabulary/save', 'POST')).toHaveLength(1)
  expect(container.textContent).toContain('已建立 1 張單字卡')
  expect(container.querySelector(`a[href="/relaiapp/cards/${cardId}"]`)).toBeTruthy()
 })
 it('keeps the answer off the card front and separates each back field', async () => {
  await renderAt('cards')
  const front = container.querySelector<HTMLElement>('.flip-card-face:not(.flip-card-back)')!
  expect(front.textContent?.replace(/\s/g, '')).toBe('serendipityn.')
  expect(front.textContent).not.toContain('意外發現珍奇事物的運氣')
  expect(front.textContent).not.toContain('Meeting my business partner')
  expect(button('翻面').className).toContain('h-12')
  expect(button('下一張').className).toContain('h-12')
  expect(button('完成複習').className).toContain('h-12')

  await click(button('翻面'))
  const back = container.querySelector<HTMLElement>('.flip-card-back')!
  expect(back.textContent).toContain('繁體中文釋義')
  expect(back.textContent).toContain('意外發現珍奇事物的運氣')
  expect(back.textContent).toContain('英文例句')
  expect(back.textContent).toContain('Meeting my business partner')
  expect(back.textContent).toContain('例句中文翻譯')
  expect(back.textContent).toContain('在都柏林那間小咖啡館遇見我的事業夥伴')
 })
 it('opens the exact recent card and the full vocabulary list with its favorites filter', async () => {
  server.home.cards.find(card => card.id === 'vocab-2')!.is_favorite = true
  await renderAt('home')
  expect(container.textContent).not.toContain('錯誤卡')
  expect(container.querySelector('a[href="/relaiapp/error-log"]')).toBeNull()
  const recent = container.querySelector<HTMLAnchorElement>('a[href="/relaiapp/cards/vocab-1"]')!
  expect(recent.textContent).toContain('serendipity')
  expect(recent.textContent).not.toContain('Meeting my business partner')
  await click(recent)
  expect(window.location.pathname).toBe('/relaiapp/cards/vocab-1')
  expect(container.querySelector('select[aria-label="篩選卡片"]')).toBeNull()
  expect(container.querySelector('.flip-card-face:not(.flip-card-back)')?.textContent).toContain('serendipity')

  await refreshAt('home')
  await click(container.querySelector('a[href="/relaiapp/vocabulary"]')!)
  expect(window.location.pathname).toBe('/relaiapp/vocabulary')
  expect(['serendipity', 'grand', 'procrastinate', 'craic'].every(word => container.textContent?.includes(word))).toBe(true)
  const grandRow = container.querySelector<HTMLAnchorElement>('main a[href="/relaiapp/cards/vocab-2"]')!
  expect(grandRow.textContent).toContain('adj.')
  expect(grandRow.textContent).toContain('很好、沒問題（口語，常見於愛爾蘭英語）')
  expect(grandRow.querySelector('.line-clamp-2')).not.toBeNull()
  expect(requests('/cards').some(([url]) => new URL(String(url), 'https://example.test').searchParams.get('card_type') === 'vocabulary')).toBe(true)
  await click(button('收藏'))
  expect(container.querySelectorAll('main a[href^="/relaiapp/cards/"]')).toHaveLength(1)
  const favorite = container.querySelector<HTMLAnchorElement>('main a[href="/relaiapp/cards/vocab-2"]')!
  await click(favorite)
  expect(window.location.pathname).toBe('/relaiapp/cards/vocab-2')
  expect(container.querySelector('.flip-card-face:not(.flip-card-back)')?.textContent).toContain('grand')
 })
 it('offers camera and file upload on the dedicated AI recognition screen', async () => {
  await renderAt('home')
  expect(container.querySelector('a[href="/relaiapp/capture"]')?.textContent).toContain('AI 辨識')
  expect(container.querySelector('a[href="/relaiapp/error-log"]')).toBeNull()
  await click(container.querySelector('a[href="/relaiapp/capture"]')!)
  const camera = container.querySelector<HTMLInputElement>('input[aria-label="拍攝照片"]')!
  const picker = container.querySelector<HTMLInputElement>('input[aria-label="從裝置選擇照片"]')!
  expect(camera.getAttribute('capture')).toBe('environment')
  expect(camera.accept).toBe('image/*')
  expect(picker.accept).toContain('image/png')
  await refreshAt('cards')
  expect([...container.querySelectorAll<HTMLSelectElement>('select option')].map(option => option.value)).not.toContain('error_log')
 })
 it('keeps onboarding available after catalog failure and retries the same selected level', async () => {
  server.home.settings.english_level = null
  vi.mocked(fetch).mockImplementationOnce(async () => Response.json({ user: { id: 'owner', username: 'Alex', display_name: 'Alex', role: 'user', must_change_password: false } }))
  await renderAt('home')
  await click(container.querySelector('input[value="A2"]')!)
  vi.mocked(fetch).mockImplementationOnce(async () => new Response('private details', { status: 503 }))
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('請稍後重試')
  expect(container.textContent).not.toContain('private')
  expect(window.location.pathname).toBe('/relaiapp/onboarding')
  await submit(); expect(window.location.pathname).toBe('/relaiapp/home')
 })
 it('prioritizes password change over onboarding and makes no product requests', async () => {
  mustChange = true; server.home.settings.english_level = null
  await renderAt('onboarding')
  expect(window.location.pathname).toBe('/relaiapp/change-password')
  expect(requests('/settings')).toHaveLength(0)
  expect(requests('/onboarding/level')).toHaveLength(0)
 })
 it('redirects an existing level away from first-use onboarding without bootstrap', async () => {
  await renderAt('onboarding')
  expect(window.location.pathname).toBe('/relaiapp/home')
  expect(requests('/onboarding/level')).toHaveLength(0)
 })
 it('fails closed on a settings read failure and retries before showing product data', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  let fail = true
  vi.mocked(fetch).mockImplementation(async (url, init) => {
   if (String(url).endsWith('/settings') && fail) { fail = false; return new Response(null, { status: 503 }) }
   return original(url, init)
  })
  await renderAt('home')
  expect(container.textContent).toContain('讀取資料失敗')
  expect(requests('/cards')).toHaveLength(0)
  await click(button('重試')); expect(container.textContent).toContain('今日進度')
 })
 it('keeps flip, view, next and filters read-only; completion refreshes real progress', async () => {
  await renderAt('cards')
  expect(button('完成複習').disabled).toBe(true)
  await click(button('翻面'))
  expect(requests('/reviews')).toHaveLength(0)
  await click(button('完成複習'))
  expect(requests('/reviews', 'POST')).toHaveLength(1)
  const body = JSON.parse(String(requests('/reviews')[0][1]?.body))
  expect(body).toEqual({ card_id: 'vocab-1', review_result: 'viewed', client_event_id: expect.any(String) })
  expect(body.client_event_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(container.textContent).toContain('今日 7 / 10 次')
  expect(button('已完成複習').disabled).toBe(true)
  await click(container.querySelector('a[aria-label="返回首頁"]')!)
  expect(container.textContent).toContain('已完成 7 次複習')
  expect(container.textContent).toContain('127')
 })
 it('resets a single-card visit on Next without generating a review', async () => {
  server.home.cards = server.home.cards.slice(0, 1)
  await renderAt('cards'); await click(button('翻面')); await click(button('完成複習'))
  await click(button('下一張'))
  expect(button('翻面').getAttribute('aria-pressed')).toBe('false')
  expect(requests('/reviews')).toHaveLength(1)
  await click(button('翻面')); await click(button('完成複習'))
  expect(requests('/reviews')).toHaveLength(2)
  expect(server.events.size).toBe(2)
 })
 it('reuses the review event ID after an uncertain response without double-counting', async () => {
  await renderAt('cards'); await click(button('翻面'))
  const original = vi.mocked(fetch).getMockImplementation()!
  let uncertain = true
  vi.mocked(fetch).mockImplementation(async (url, init) => {
   if (String(url).endsWith('/reviews') && uncertain) { uncertain = false; server.response(String(url), init); throw new Error('network lost after commit') }
   return original(url, init)
  })
  await click(button('完成複習'))
  expect(container.textContent).toContain('操作未能確認')
  await click(button('完成複習'))
  expect(requests('/reviews')).toHaveLength(2)
  expect(requests('/reviews')[0][1]?.body).toBe(requests('/reviews')[1][1]?.body)
  expect(server.events.size).toBe(1)
  expect(container.textContent).toContain('今日 7 / 10 次')
 })
 it('keeps vocabulary read-only while persisting favorite/delete through remount', async () => {
  await renderAt('cards'); await click(button('收藏'))
  await change('select[aria-label="篩選卡片"]', 'favorites')
  expect(container.textContent).toContain('1 / 1')
  const favoritesRequest = requests('/cards').find(([url]) => String(url).includes('favorite=true'))
  expect(favoritesRequest).toBeTruthy()
  expect(new URL(String(favoritesRequest?.[0]), 'https://example.test').searchParams.get('card_type')).toBe('vocabulary')
  expect([...container.querySelectorAll('button')].some(element => element.textContent?.trim() === '編輯')).toBe(false)
  expect(requests('/cards/vocab-1', 'PATCH')).toHaveLength(0)
  await refreshAt('cards')
  expect(container.querySelector('[aria-label="取消收藏"]')).not.toBeNull()
  await click(button('刪除'))
  expect(requests('/cards/vocab-1', 'DELETE')).toHaveLength(0)
  await click(button('取消')); expect(requests('/cards/vocab-1', 'DELETE')).toHaveLength(0)
  await click(button('刪除')); await click(button('確認刪除'))
  await refreshAt('cards')
  expect(container.textContent).not.toContain('serendipity')
  expect(container.textContent).toContain('1 / 3')
  expect(requests('/reviews')).toHaveLength(0)
 })
 it('edits Error Log content via the same card API and only reviews on completion', async () => {
  await renderAt('error-log')
  expect(requests('/reviews')).toHaveLength(0)
  await click(button('編輯'))
  expect(container.querySelector('[name="zh_tw_definition"]')).toBeNull()
  await change('textarea[name="part_of_speech"]', '時態')
  await change('textarea[name="explanation"]', '已修正的說明')
  await submit(); await refreshAt('error-log')
  expect(container.textContent).toContain('已修正的說明')
  expect(requests('/reviews')).toHaveLength(0)
  await click(button('完成複習')); expect(requests('/reviews')).toHaveLength(1)
 })
 it('applies Needs Review in the server and removes completed cards from that filter', async () => {
  await renderAt('cards'); await change('select', 'needs_review')
  expect(requests('/cards').some(([url]) => String(url).includes('needs_review=true'))).toBe(true)
  await click(button('翻面')); await click(button('完成複習'))
  expect(container.textContent).not.toContain('serendipity')
  expect(container.textContent).toContain('1 / 3')
  await refreshAt('error-log')
  expect(container.textContent).toContain('原句')
  await refreshAt('cards'); expect(container.textContent).toContain('serendipity')
 })
 it('shows real statistics and persists settings without bootstrapping or deleting cards', async () => {
  await renderAt('stats')
  expect(container.textContent).toContain('最長連續'); expect(container.textContent).toContain('126')
  await refreshAt('settings')
  expect([...container.querySelectorAll('option')].map(option => option.value)).toEqual(['A1', 'A2', 'B1', 'B2'])
  await change('input[name="daily_goal"]', '20')
  await change('input[name="timezone"]', 'Europe/Dublin')
  await change('select[name="english_level"]', 'B1'); await submit()
  expect(container.textContent).toContain('設定已儲存')
  expect(requests('/settings', 'PATCH')[0][1]?.body).toBe(JSON.stringify({ daily_goal: 20, timezone: 'Europe/Dublin', english_level: 'B1' }))
  await refreshAt('settings')
  expect(container.querySelector<HTMLInputElement>('[name="daily_goal"]')?.value).toBe('20')
  expect(container.querySelector<HTMLInputElement>('[name="timezone"]')?.value).toBe('Europe/Dublin')
  expect(container.querySelector<HTMLSelectElement>('[name="english_level"]')?.value).toBe('B1')
  expect(server.home.cards).toHaveLength(7)
  expect(requests('/onboarding/level')).toHaveLength(0)
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
 })
 it('does not post invalid settings and shows safe mutation failures for retry', async () => {
  await renderAt('settings'); await change('input[name="timezone"]', 'invalid-zone'); await submit()
  expect(container.textContent).toContain('有效時區'); expect(requests('/settings', 'PATCH')).toHaveLength(0)
  await change('input[name="timezone"]', 'UTC')
  vi.mocked(fetch).mockImplementationOnce(async () => new Response('private backend', { status: 500 }))
  await submit(); expect(container.textContent).toContain('設定暫時無法儲存'); expect(container.textContent).not.toContain('private')
  await submit(); expect(container.textContent).toContain('設定已儲存')
 })
 it('shows loading, empty and retry states without stale filter cards or mock fallback', async () => {
  await renderAt('cards')
  let resolveCards!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveCards = resolve }))
  await change('select', 'favorites')
  expect(container.textContent).toContain('正在讀取資料')
  expect(container.textContent).not.toContain('serendipity')
  await act(() => resolveCards(Response.json({ cards: [], next_cursor: null })))
  expect(container.textContent).toContain('目前沒有符合篩選的')
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(null, { status: 503 }))
  await change('select', 'needs_review')
  expect(container.textContent).toContain('讀取資料失敗')
  await click(button('重試')); expect(container.textContent).toContain('serendipity')
  expect(container.querySelector('[data-source="mock"]')).toBeNull()
  expect(container.textContent).not.toMatch(/新增卡片|建立卡片|AI 活動|最近擷取/)
 })
 it('clears protected data when a product request reports session expiry', async () => {
  await renderAt('cards')
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(null, { status: 401 }))
  await click(button('收藏'))
  expect(window.location.pathname).toBe('/relaiapp/login')
  expect(container.textContent).not.toContain('serendipity')
 })
})
