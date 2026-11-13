import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ko' } }),
}))

import { OnboardingGuideCard } from './OnboardingGuideCard'
import { translations } from '../../locales/translations'

const noop = () => {}

function render(action?: { label: string; onClick: () => void }): string {
  return renderToStaticMarkup(
    <OnboardingGuideCard icon={<span />} title="title" description="desc" points={['one']} onDismiss={noop} action={action} />,
  )
}

describe('OnboardingGuideCard action', () => {
  it('renders only the acknowledge button without an action', () => {
    const html = render()
    expect(html).toContain('onboarding_acknowledge')
    expect(html).not.toContain('import-list')
  })

  it('renders the offered next step before the acknowledge button', () => {
    const html = render({ label: 'import-list', onClick: noop })
    expect(html.indexOf('import-list')).toBeGreaterThan(-1)
    expect(html.indexOf('import-list')).toBeLessThan(html.indexOf('onboarding_acknowledge'))
  })
})

describe('inventory import entry copy', () => {
  const keys = [
    'empty_inventory_import_action',
    'empty_inventory_import_hint',
    'empty_inventory_import_hint_v2',
    'onboarding_inventory_import_action',
  ]

  it('exists in both languages', () => {
    for (const language of ['ko', 'en'] as const) {
      const table = translations[language] as Record<string, unknown>
      for (const key of keys) expect(table[key], `${language}.${key}`).toEqual(expect.any(String))
    }
  })
})
