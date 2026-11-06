import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko' },
  }),
}))

vi.mock('../hooks/useAuth', () => ({
  resendSignupConfirmation: vi.fn(),
}))

import { AuthView } from './AuthView'

describe('AuthView login form', () => {
  it('uses mobile-friendly email input hints and a password visibility toggle', () => {
    const html = renderToStaticMarkup(
      <AuthView
        onSignIn={vi.fn()}
        onSignUp={vi.fn()}
        onRequestPasswordReset={vi.fn()}
      />,
    )

    expect(html).toContain('type="email"')
    expect(html).toContain('autoComplete="email"')
    expect(html).toContain('inputMode="email"')
    expect(html).toContain('autoCapitalize="none"')
    expect(html).toContain('aria-label="auth_show_password"')
    expect(html.match(/type="password"/g)).toHaveLength(1)
  })
})
