// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from './App'
import { clientData } from './services/data'

const user = { id: 'test-user', username: 'Alex', display_name: 'Alex', role: 'user' }
const authResponse = () => Response.json({ user })

describe('migrated client under /relaiapp', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubEnv('BASE_URL', '/relaiapp/')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.endsWith('/auth/logout') ? new Response(null, { status: 204 }) : url.includes('/auth/') ? authResponse() : Response.json({ status: 'ok' })))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  async function renderAt(path: string) {
    window.history.replaceState(null, '', path)
    await act(() => root.render(createElement(AppRouter)))
  }
  async function click(element: Element | null) {
    expect(element).not.toBeNull()
    await act(() => element!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
  }
  function button(text: string) {
    return [...container.querySelectorAll('button')].find(el => el.textContent?.includes(text)) ?? null
  }
  async function input(name: string, value: string) {
    const field = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  it.each(['home', 'cards', 'flashcards', 'error-log', 'stats', 'settings'])('redirects unauthenticated %s, including aliases', async path => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }))
    await renderAt(`/relaiapp/${path}`)
    expect(window.location.pathname).toBe('/relaiapp/login')
    expect(container.textContent).toContain('登入你的帳號')
    expect(container.textContent).not.toContain('serendipity')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not mount protected content or load product data during bootstrap', async () => {
    let resolveMe!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { resolveMe = resolve }))
    const product = vi.spyOn(clientData, 'getHome')
    await renderAt('/relaiapp/home')
    expect(container.textContent).toContain('正在確認登入狀態')
    expect(container.textContent).not.toContain('今日進度')
    expect(product).not.toHaveBeenCalled()
    await act(() => resolveMe(new Response(null, { status: 401 })))
    expect(window.location.pathname).toBe('/relaiapp/login')
    expect(product).not.toHaveBeenCalled()
  })
  it.each([
    () => Promise.reject(new Error('private network detail')),
    async () => new Response('private server detail', { status: 503 }),
    async () => Response.json({ user: { username: 'incomplete' } }),
  ])('fails closed on bootstrap failure and supports retry', async failure => {
    vi.mocked(fetch).mockImplementationOnce(failure)
    await renderAt('/relaiapp/home')
    expect(container.textContent).toContain('無法確認登入狀態')
    expect(container.textContent).not.toMatch(/private|serendipity|今日進度/)
    expect(window.location.pathname).toBe('/relaiapp/home')
    await click(button('重試'))
    expect(container.textContent).toContain('今日進度')
    expect(container.textContent).toContain('Alex')
  })
  it.each([401, 503])('shows safe login failure for HTTP %s and clears the password', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('username exists; private detail', { status }))
    await renderAt('/relaiapp/login')
    await input('username', 'Exact User')
    await input('password', 'Secret')
    await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(window.location.pathname).toBe('/relaiapp/login')
    expect(container.textContent).toContain(status === 401 ? '登入資訊不正確。' : '登入服務暫時無法使用')
    expect(container.textContent).not.toMatch(/username exists|private detail|Secret/)
    expect(container.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe('')
  })
  it('returns to login when a restored session expires on app focus', async () => {
    await renderAt('/relaiapp/home')
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }))
    await act(() => window.dispatchEvent(new Event('focus')))
    expect(window.location.pathname).toBe('/relaiapp/login')
    expect(container.textContent).not.toContain('今日進度')
  })
  it('clears auth when centralized transport receives a session 401', async () => {
    await renderAt('/relaiapp/home')
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }))
    const { apiClient } = await import('./lib/api')
    await act(async () => { await expect(apiClient.getHealth()).rejects.toMatchObject({ status: 401 }) })
    expect(window.location.pathname).toBe('/relaiapp/login')
  })
  it('clears local state after logout failure without claiming server revocation', async () => {
    await renderAt('/relaiapp/home')
    vi.mocked(fetch).mockRejectedValue(new Error('private'))
    await click(button('登出'))
    expect(window.location.pathname).toBe('/relaiapp/login')
    expect(container.textContent).toContain('無法確認伺服器登出')
    expect(container.textContent).not.toContain('private')
  })
  it('does not let a stale bootstrap overwrite a successful login', async () => {
    let resolveMe!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(url => String(url).endsWith('/auth/me')
      ? new Promise(resolve => { resolveMe = resolve })
      : Promise.resolve(String(url).endsWith('/auth/login') ? authResponse() : Response.json({ status: 'ok' })))
    await renderAt('/relaiapp/login')
    await input('username', 'Alex')
    await input('password', 'Secret')
    await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await act(() => resolveMe(new Response(null, { status: 401 })))
    expect(window.location.pathname).toBe('/relaiapp/home')
    expect(container.textContent).toContain('今日進度')
  })
  it('waits for logout before redirecting and hides protected content meanwhile', async () => {
    await renderAt('/relaiapp/home')
    let resolveLogout!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { resolveLogout = resolve }))
    await click(button('登出'))
    expect(window.location.pathname).toBe('/relaiapp/home')
    expect(container.textContent).toContain('正在確認登入狀態')
    expect(container.textContent).not.toContain('今日進度')
    await act(() => resolveLogout(new Response(null, { status: 204 })))
    expect(window.location.pathname).toBe('/relaiapp/login')
  })
  it('does not leave auth unresolved after login fails during bootstrap', async () => {
    let resolveMe!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(url => String(url).endsWith('/auth/me')
      ? new Promise(resolve => { resolveMe = resolve })
      : Promise.resolve(new Response(null, { status: 401 })))
    await renderAt('/relaiapp/login')
    await input('username', 'Alex')
    await input('password', 'Secret')
    await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await act(() => resolveMe(authResponse()))
    await act(() => {
      window.history.replaceState(null, '', '/relaiapp/home')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(window.location.pathname).toBe('/relaiapp/login')
    expect(container.textContent).not.toContain('正在確認登入狀態')
  })
  it.each(['/relaiapp', '/relaiapp/'])('renders splash at %s', async path => {
    await renderAt(path)
    expect(container.textContent).toContain('你的 AI 英語第二大腦')
    expect(container.textContent).not.toMatch(/註冊|register/i)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/relaiapp/login')
  })
  it.each([
    ['login', '登入你的帳號'], ['home', '今日進度'], ['cards', 'serendipity'],
    ['flashcards', 'serendipity'], ['error-log', '錯誤筆記'],
    ['stats', '學習統計'], ['settings', '設定'],
  ])('supports direct navigation to %s', async (path, content) => {
    await renderAt(`/relaiapp/${path}`)
    expect(container.textContent).toContain(content)
    if (['cards', 'flashcards', 'error-log'].includes(path)) {
      expect(container.querySelector('[data-source="mock"]')?.textContent).toContain('模擬資料')
      expect(fetch).toHaveBeenCalledWith('/relaiapp/api/v1/auth/me', expect.objectContaining({ credentials: 'same-origin' }))
    }
    if (path === 'flashcards') expect(window.location.pathname).toBe('/relaiapp/cards')
  })
  it('logs in with exact credentials and logs out without credential storage', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/auth/me')) return new Response(null, { status: 401 })
      if (String(url).endsWith('/auth/logout')) return new Response(null, { status: 204 })
      if (String(url).endsWith('/auth/login')) return authResponse()
      return Response.json({ status: 'ok' })
    })
    await renderAt('/relaiapp/login')
    await input('username', ' Alex ')
    await input('password', ' Dummy SECRET ')
    await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(fetch).toHaveBeenCalledWith('/relaiapp/api/v1/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ username: ' Alex ', password: ' Dummy SECRET ' }),
    }))
    expect(window.location.pathname).toBe('/relaiapp/home')
    expect(container.textContent).toContain('Alex')
    expect(container.textContent).toContain('serendipity')
    expect(container.textContent).toContain('已完成 6 次複習')
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('60')
    await click(button('登出'))
    expect(fetch).toHaveBeenCalledWith('/relaiapp/api/v1/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(window.location.pathname).toBe('/relaiapp/login')
    expect(container.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe('')
    expect(storageSpy).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    await act(() => {
      window.history.replaceState(null, '', '/relaiapp/home')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(window.location.pathname).toBe('/relaiapp/login')
  })
  it('navigates with React Router and responds to history changes under basename', async () => {
    await renderAt('/relaiapp/home')
    await click(container.querySelector('nav a[href="/relaiapp/cards"]'))
    expect(window.location.pathname).toBe('/relaiapp/cards')
    expect(container.textContent).toContain('單字卡複習')
    await click(container.querySelector('a[aria-label="返回首頁"]'))
    expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe('首頁')
    await click(container.querySelector('nav a[href="/relaiapp/error-log"]'))
    expect(container.textContent).toContain('錯誤筆記')
    await act(() => {
      window.history.replaceState(null, '', '/relaiapp/home')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(container.textContent).toContain('今日進度')
    expect([...container.querySelectorAll('a')].every(a => a.pathname.startsWith('/relaiapp/'))).toBe(true)
  })
  it('flips, advances, resets the face, renders Irish usage and wraps vocabulary cards', async () => {
    await renderAt('/relaiapp/cards')
    expect(container.textContent).toContain('1 / 4')
    expect(container.querySelector('.flip-card-back')?.getAttribute('aria-hidden')).toBe('true')
    await click(button('翻面'))
    expect(container.querySelector('.flip-card-inner')?.classList.contains('flipped')).toBe(true)
    expect(button('翻面')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.flip-card-back')?.getAttribute('aria-hidden')).toBe('false')
    expect(container.textContent).toContain('Meeting my business partner')
    await click(button('下一張'))
    expect(container.textContent).toContain('grand')
    expect(container.textContent).toContain('Irish usage')
    expect(container.textContent).toContain('2 / 4')
    expect(button('翻面')?.getAttribute('aria-pressed')).toBe('false')
    for (let i = 0; i < 3; i++) await click(button('下一張'))
    expect(container.textContent).toContain('1 / 4')
    expect(container.textContent).toContain('serendipity')
  })
  it('renders error sentences, corrections, explanations and next error', async () => {
    await renderAt('/relaiapp/error-log')
    expect(container.textContent).toContain('The occurrence')
    expect(container.textContent).toContain('句首需大寫')
    expect(container.textContent).toContain('文法錯誤')
    await click(button('下一張'))
    expect(container.textContent).toContain("I didn't went to the meeting yesterday.")
    expect(container.textContent).toContain("I didn't go to the meeting yesterday.")
    expect(container.textContent).toContain('didn\'t 後方需接動詞原形')
  })
  it.each(['/auth?mode=register', '/login?mode=register'])('never exposes registration via legacy query %s', async path => {
    await renderAt(`/relaiapp${path}`)
    expect(container.textContent).toContain('登入你的帳號')
    expect(container.textContent).not.toMatch(/註冊|register|Email|建立帳號/)
    expect(container.querySelectorAll('input')).toHaveLength(2)
  })
  it('handles empty card data and service failure', async () => {
    vi.spyOn(clientData, 'listCards').mockResolvedValue([])
    await renderAt('/relaiapp/cards')
    expect(container.textContent).toContain('目前沒有 vocabulary 卡片')
    expect(button('下一張')?.hasAttribute('disabled')).toBe(true)
    vi.spyOn(clientData, 'getHome').mockRejectedValue(new Error('private backend detail'))
    await click(container.querySelector('a'))
    expect(container.textContent).toContain('讀取資料失敗')
    expect(container.textContent).not.toContain('private backend detail')
  })
  it('renders a client not-found screen', async () => {
    await renderAt('/relaiapp/unknown')
    expect(container.textContent).toContain('找不到頁面')
  })
  it('shows real health loading/success while product data remains mock', async () => {
    let resolveHealth!: (value: Response) => void
    vi.mocked(fetch).mockImplementation(url => String(url).endsWith('/auth/me') ? Promise.resolve(authResponse()) : new Promise<Response>(resolve => { resolveHealth = resolve }))
    await renderAt('/relaiapp/home')
    const healthPanel = container.querySelector('[aria-label="Worker 連線"]')!
    expect(healthPanel.getAttribute('data-source')).toBe('api')
    expect(healthPanel.textContent).toContain('真實 API')
    expect(healthPanel.textContent).toContain('正在檢查服務連線')
    expect(button('重新檢查連線')?.hasAttribute('disabled')).toBe(true)
    expect(container.querySelector('[data-source="mock"]')?.textContent).toContain('首頁、卡片、統計與設定：模擬資料')
    expect(container.textContent).toContain('serendipity')
    await act(() => resolveHealth(Response.json({ status: 'ok' })))
    expect(healthPanel.textContent).toContain('health: ok')
    expect(button('重新檢查連線')?.hasAttribute('disabled')).toBe(false)
  })
  it.each([
    () => Promise.reject(new Error('private network detail')),
    async () => new Response('private server detail', { status: 503 }),
    async () => Response.json({ status: 'down' }),
  ])('handles health failure independently and can retry the real request', async failure => {
    let failHealth = true
    vi.mocked(fetch).mockImplementation(url => {
      if (String(url).endsWith('/auth/me')) return Promise.resolve(authResponse())
      if (failHealth) { failHealth = false; return failure() }
      return Promise.resolve(Response.json({ status: 'ok' }))
    })
    await renderAt('/relaiapp/home')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('無法連線至服務')
    expect(container.textContent).not.toContain('private')
    expect(container.textContent).toContain('serendipity')
    expect(container.textContent).toContain('已完成 6 次複習')
    await click(button('重新檢查連線'))
    expect(container.querySelector('[role="status"]')?.textContent).toContain('health: ok')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('ignores a health result after navigating away from Home', async () => {
    let resolveHealth!: (value: Response) => void
    vi.mocked(fetch).mockImplementation(url => String(url).endsWith('/auth/me') ? Promise.resolve(authResponse()) : new Promise<Response>(resolve => { resolveHealth = resolve }))
    await renderAt('/relaiapp/home')
    await click(container.querySelector('nav a[href="/relaiapp/cards"]'))
    await act(() => resolveHealth(Response.json({ status: 'ok' })))
    expect(container.querySelector('[aria-label="Worker 連線"]')).toBeNull()
    expect(container.textContent).toContain('serendipity')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
