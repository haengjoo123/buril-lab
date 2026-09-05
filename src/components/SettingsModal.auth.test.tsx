import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: vi.fn() },
  }),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    session: null,
    updatePassword: vi.fn(),
    deleteAccount: vi.fn(),
  }),
}))

vi.mock('../hooks/useThemeMode', () => ({
  useThemeMode: () => ({ isDarkMode: false, toggleThemeMode: vi.fn() }),
}))

vi.mock('../store/useWasteStore', () => ({
  useWasteStore: (selector: (state: object) => unknown) => selector({
    clearCart: vi.fn(),
    clearSearchHistory: vi.fn(),
  }),
}))

vi.mock('../store/useOnboardingStore', () => ({
  useOnboardingStore: (selector: (state: object) => unknown) => selector({ resetOnboarding: vi.fn() }),
}))

vi.mock('../services/supabaseClient', () => ({ supabase: {} }))
vi.mock('../services/analyticsService', () => ({ analyticsService: { trackOnboardingEvent: vi.fn() } }))
vi.mock('./CustomDialog', () => ({ CustomDialog: () => null }))
vi.mock('./MfaSettingsPanel', () => ({
  MfaSettingsPanel: () => <div data-testid="mfa-settings-marker">mfa-settings-marker</div>,
}))

import { SettingsModal } from './SettingsModal'

describe('SettingsModal authentication state', () => {
  it('shows account and MFA settings when the parent layout confirms authentication', () => {
    const html = renderToStaticMarkup(<SettingsModal isAuthenticated onClose={vi.fn()} />)

    expect(html).toContain('settings_password_change')
    expect(html).toContain('mfa-settings-marker')
    expect(html).toContain('settings_delete_account')
    expect(html).toContain('settings_delete_account_desc')
  })

  it('does not show account or MFA settings for guests', () => {
    const html = renderToStaticMarkup(<SettingsModal isAuthenticated={false} onClose={vi.fn()} />)

    expect(html).not.toContain('settings_password_change')
    expect(html).not.toContain('mfa-settings-marker')
    expect(html).not.toContain('settings_delete_account')
  })
})
