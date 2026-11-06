import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', resolvedLanguage: 'ko' },
  }),
}))

import { GatewayLanding } from './GatewayLanding'

function renderLanding(isAuthenticated: boolean) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <GatewayLanding
        isAuthenticated={isAuthenticated}
        userEmail={isAuthenticated ? 'lab@example.com' : undefined}
        onNavigateToApp={vi.fn()}
        onNavigateToCenter={vi.fn()}
        onLoginClick={vi.fn()}
        onSignOut={isAuthenticated ? vi.fn() : undefined}
      />
    </MemoryRouter>,
  )
}

describe('GatewayLanding', () => {
  it('lets visitors search straight from the hero', () => {
    const html = renderLanding(false)
    expect(html).toContain('role="search"')
    expect(html).toContain('placeholder="search_placeholder"')
    expect(html).toContain('로그인')
  })

  it('gives signed-in users a way into the app instead of a lone logout icon', () => {
    const html = renderLanding(true)
    expect(html).toContain('앱 열기')
    expect(html).not.toContain('aria-label="로그아웃"')
  })
})
