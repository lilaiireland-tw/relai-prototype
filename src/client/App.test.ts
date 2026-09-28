import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('client runtime scaffold', () => {
  it('renders the minimal root application', () => {
    const markup = renderToStaticMarkup(createElement(App))

    expect(markup).toContain('<h1>ReLai</h1>')
    expect(markup).toContain('Cloudflare runtime foundation')
  })
})
