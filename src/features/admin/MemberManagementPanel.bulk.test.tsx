// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stable `t`, like the real hook: the member list reloads whenever `t` changes.
const i18nMock = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) => (
    options && ('count' in options || 'success' in options) ? `${key}:${JSON.stringify(options)}` : key
  ),
  i18n: { language: 'ko', changeLanguage: () => Promise.resolve() },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => i18nMock }))
vi.mock('../../services/supabaseClient', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-user' } } }) } },
}))
vi.mock('../../services/labService', () => ({
  labService: { getLabMembers: vi.fn(), updateMemberRole: vi.fn(), transferAdmin: vi.fn(), removeMember: vi.fn(), getMyLabs: vi.fn() },
}))
vi.mock('../../components/LabInviteButton', () => ({ LabInviteButton: () => null }))

import { labService } from '../../services/labService'
import { useLabStore } from '../../store/useLabStore'
import { MemberManagementPanel } from './MemberManagementPanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAY = 24 * 60 * 60 * 1000
let container: HTMLDivElement
let root: Root

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function render(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <MemberManagementPanel />
      </MemoryRouter>,
    )
  })
  await flush()
}

function buttonStartingWith(label: string, scope: ParentNode = document): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find((element) => element.textContent?.trim().startsWith(label))
  if (!match) throw new Error(`No button ${label}`)
  return match
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  const recent = new Date(Date.now() - DAY).toISOString()
  useLabStore.setState({
    currentLabId: 'lab-1',
    myLabs: [{ id: 'm', lab_id: 'lab-1', user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z', lab: { id: 'lab-1', name: 'Lab', created_by: 'admin-user', created_at: '' } }],
  })
  vi.mocked(labService.getLabMembers).mockResolvedValue([
    { user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z', email: 'admin@example.com' },
    { user_id: 'old-user', role: 'graduate', joined_at: '2026-01-02T00:00:00Z', email: 'old@example.com' },
    { user_id: 'new-a', role: 'student', joined_at: recent, email: 'a@example.com' },
    { user_id: 'new-b', role: 'student', joined_at: recent, email: 'b@example.com' },
  ])
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('MemberManagementPanel new member filter', () => {
  it('shows no checkboxes without ?filter=new', async () => {
    await render('/app/admin?tab=members')
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0)
  })

  it('assigns one role to the selected new members after one confirmation', async () => {
    vi.mocked(labService.updateMemberRole)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'))
    await render('/app/admin?tab=members&filter=new')

    expect(container.textContent).toContain('admin_members_new_filter_notice')
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    // Only the two new members can be picked: not the admin, not the older member.
    expect(checkboxes).toHaveLength(2)

    await click(buttonStartingWith('admin_members_select_new', container))
    expect(container.textContent).toContain('admin_bulk_role_selected:{"count":2}')

    await click(buttonStartingWith('admin_bulk_role_placeholder', container))
    await click(buttonStartingWith('member_role_graduate', container.querySelector('[role="listbox"]')!))
    await click(buttonStartingWith('admin_bulk_role_apply', container))

    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('admin_bulk_role_confirm_body:{"count":2,"role":"member_role_graduate"}')
    expect(labService.updateMemberRole).not.toHaveBeenCalled()

    await click(buttonStartingWith('admin_bulk_role_apply', dialog))
    expect(vi.mocked(labService.updateMemberRole).mock.calls).toEqual([
      ['lab-1', 'new-a', 'graduate'],
      ['lab-1', 'new-b', 'graduate'],
    ])
    expect(document.body.textContent).toContain('admin_bulk_role_partial:{"success":1,"failed":1}')
    // The failed member stays selected for another try.
    expect(container.textContent).toContain('admin_bulk_role_selected:{"count":1}')
  })

  it('moves focus to the new-member notice once the bulk bar closes', async () => {
    vi.mocked(labService.updateMemberRole).mockResolvedValue(undefined)
    await render('/app/admin?tab=members&filter=new')

    await click(buttonStartingWith('admin_members_select_new', container))
    await click(buttonStartingWith('admin_bulk_role_placeholder', container))
    await click(buttonStartingWith('member_role_graduate', container.querySelector('[role="listbox"]')!))
    const apply = buttonStartingWith('admin_bulk_role_apply', container)
    apply.focus()
    await click(apply)
    const dialog = document.querySelector('[role="dialog"]')!
    const confirm = buttonStartingWith('admin_bulk_role_apply', dialog)
    confirm.focus()
    await click(confirm)

    expect(document.body.textContent).toContain('admin_bulk_role_success:{"count":2}')
    // Everything worked, so the selection and its bar are gone (with the 적용 button the dialog
    // would hand focus back to): focus lands on the notice instead of <body>.
    expect(container.textContent).not.toContain('admin_bulk_role_selected')
    expect(document.activeElement?.textContent).toContain('admin_members_new_filter_notice')
    expect(document.activeElement?.tagName).toBe('P')
  })
})
