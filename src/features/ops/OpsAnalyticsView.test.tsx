import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: vi.fn() },
  }),
}))
vi.mock('../../locales/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../services/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../components/MfaSettingsPanel', () => ({ MfaSettingsPanel: () => null }))

import { OpsAnalyticsView } from './OpsAnalyticsView'

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <OpsAnalyticsView />
    </MemoryRouter>,
  )
}

function currentTab(html: string): string | undefined {
  return /aria-current="page"[^>]*>([^<]+)</.exec(html)?.[1]
}

describe('OpsAnalyticsView sub-tab URL', () => {
  it('opens the overview with the period picker when no tab is given', () => {
    const html = render('/ops/analytics')
    expect(currentTab(html)).toBe('ops_an_tab_overview')
    expect(html).toContain('aria-label="ops_an_range"')
  })

  it('restores the tab named in ?tab=', () => {
    const html = render('/ops/analytics?tab=reviews')
    expect(currentTab(html)).toBe('ops_an_tab_reviews')
    // The review list ignores the period and offers the pending/all toggle instead.
    expect(html).not.toContain('aria-label="ops_an_range"')
    expect(html).toContain('aria-label="ops_an_review_filter_label"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>ops_an_review_status_pending</)
  })

  it('falls back to the overview for an unknown tab', () => {
    expect(currentTab(render('/ops/analytics?tab=search'))).toBe('ops_an_tab_overview')
    expect(currentTab(render('/ops/analytics?tab=%3Cscript%3E'))).toBe('ops_an_tab_overview')
  })

  it('keeps the refresh button on tabs without a period', () => {
    const html = render('/ops/analytics?tab=governance')
    expect(currentTab(html)).toBe('ops_an_tab_governance')
    expect(html).not.toContain('aria-label="ops_an_range"')
    expect(html).toContain('ops_an_refresh')
  })

  it('shows a loading state for the tab instead of blocking the whole screen', () => {
    const html = render('/ops/analytics?tab=searches')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="ops_an_nav_label"')
  })
})
