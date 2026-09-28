// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from './App'

describe('client routes under /relaiapp', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubEnv('BASE_URL', '/relaiapp/')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  async function renderAt(path: string) {
    window.history.replaceState(null, '', path)
    await act(() => root.render(
      createElement(AppRouter),
    ))
  }

  it.each(['Login', 'Home', 'Cards', 'Stats', 'Settings'])(
    'renders the %s placeholder on direct navigation',
    async (page) => {
      await renderAt(`/relaiapp/${page.toLowerCase()}`)
      expect(container.querySelector('h1')?.textContent).toBe('ReLai')
      expect(container.querySelector('h2')?.textContent).toBe(page)
      expect(container.textContent).toContain(`${page} page placeholder`)
      expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(page)
    },
  )

  it.each(['/relaiapp', '/relaiapp/'])('renders Home at the app base %s', async (path) => {
    await renderAt(path)
    expect(container.querySelector('h2')?.textContent).toBe('Home')
  })

  it('keeps navigation links and browser history under the basename', async () => {
    await renderAt('/relaiapp/home')
    const links = [...container.querySelectorAll('a')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/relaiapp/login', '/relaiapp/home', '/relaiapp/cards', '/relaiapp/stats', '/relaiapp/settings',
    ])
    await act(() => links[2].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    expect(window.location.pathname).toBe('/relaiapp/cards')
    expect(container.querySelector('h2')?.textContent).toBe('Cards')

    // Simulate the browser restoring a previous history entry.
    await act(() => {
      window.history.replaceState(null, '', '/relaiapp/home')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(container.querySelector('h2')?.textContent).toBe('Home')
  })

  it('renders a client not-found placeholder for unknown routes', async () => {
    await renderAt('/relaiapp/unknown')
    expect(container.querySelector('h2')?.textContent).toBe('Page not found')
  })
})
