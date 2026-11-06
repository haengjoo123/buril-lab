import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key),
    i18n: { language: 'ko' },
  }),
}))
vi.mock('../hooks/useThemeMode', () => ({ useThemeMode: () => ({ isDarkMode: false, toggleThemeMode: vi.fn() }) }))

import { BottomTabNav } from './BottomTabNav'
import { DesktopSideNav } from './DesktopSideNav'

const noop = () => {}

function adminButton(html: string): string {
  const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? []
  return buttons.find((button) => button.includes('tab_audit')) ?? ''
}

describe('BottomTabNav admin attention badge', () => {
  it('shows nothing without a count or for a member who is not an admin', () => {
    const none = renderToStaticMarkup(<BottomTabNav activeTab="search" isAdmin onTabClick={noop} adminAttentionCount={0} />)
    expect(adminButton(none)).not.toContain('nav_admin_attention')
    expect(adminButton(none)).not.toContain('bg-red-600')

    const member = renderToStaticMarkup(<BottomTabNav activeTab="search" isAdmin={false} onTabClick={noop} adminAttentionCount={3} />)
    expect(member).not.toContain('tab_audit')
    expect(member).not.toContain('nav_admin_attention')
  })

  it('shows the count on the icon and announces it in the tab name', () => {
    const html = adminButton(renderToStaticMarkup(<BottomTabNav activeTab="search" isAdmin onTabClick={noop} adminAttentionCount={3} />))
    expect(html).toMatch(/<span aria-hidden="true" class="absolute[^"]*bg-red-600[^"]*dark:ring-slate-900[^"]*">3<\/span>/)
    expect(html).toContain('<span class="sr-only">nav_admin_attention:{&quot;count&quot;:3}</span>')
  })

  it('caps the visible count at 9+ but announces the real number', () => {
    const html = adminButton(renderToStaticMarkup(<BottomTabNav activeTab="admin" isAdmin onTabClick={noop} adminAttentionCount={12} />))
    expect(html).toContain('>9+</span>')
    expect(html).toContain('nav_admin_attention:{&quot;count&quot;:12}')
  })

  it('only badges the admin tab', () => {
    const html = renderToStaticMarkup(<BottomTabNav activeTab="search" isAdmin onTabClick={noop} adminAttentionCount={2} />)
    expect(html.match(/nav_admin_attention/g)).toHaveLength(1)
  })
})

describe('DesktopSideNav admin attention badge', () => {
  it('badges the admin item, inverting colors when it is the active (red) item', () => {
    const inactive = adminButton(renderToStaticMarkup(
      <DesktopSideNav activeTab="search" isAdmin onTabClick={noop} onSettingsClick={noop} adminAttentionCount={4} />,
    ))
    expect(inactive).toMatch(/aria-hidden="true" class="absolute[^"]*bg-red-600 text-white ring-white dark:bg-red-500 dark:ring-slate-950[^"]*">4<\/span>/)
    expect(inactive).toContain('<span class="sr-only">nav_admin_attention:{&quot;count&quot;:4}</span>')

    const active = adminButton(renderToStaticMarkup(
      <DesktopSideNav activeTab="admin" isAdmin onTabClick={noop} onSettingsClick={noop} adminAttentionCount={10} />,
    ))
    expect(active).toMatch(/class="absolute[^"]*bg-white text-red-700 ring-red-600[^"]*">9\+<\/span>/)
  })

  it('shows nothing for a member who is not an admin or without a count', () => {
    const member = renderToStaticMarkup(
      <DesktopSideNav activeTab="search" isAdmin={false} onTabClick={noop} onSettingsClick={noop} adminAttentionCount={4} />,
    )
    expect(member).not.toContain('nav_admin_attention')
    const none = renderToStaticMarkup(
      <DesktopSideNav activeTab="search" isAdmin onTabClick={noop} onSettingsClick={noop} />,
    )
    expect(none).not.toContain('nav_admin_attention')
  })
})
