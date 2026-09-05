/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockUseUser = vi.fn()
const mockUseMemberListView = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/members'
}))

vi.mock('@/components/UserProvider', () => ({
  useUser: () => mockUseUser()
}))

vi.mock('@/context/MemberListContext', () => ({
  useMemberListView: () => mockUseMemberListView()
}))

vi.mock('@/components/MemberForm', () => ({
  default: function DummyMemberForm(props: {
    canEdit?: boolean
    isAdmin?: boolean
    isEditing?: boolean
  }) {
    return (
      <div data-testid='member-form-spy'>
        <span>canEdit:{String(props.canEdit)}</span>
        <span>isAdmin:{String(props.isAdmin)}</span>
        <span>isEditing:{String(props.isEditing)}</span>
      </div>
    )
  }
}))

vi.mock('@/context/MemberDetailContent', () => ({
  default: () => <div>Detail</div>
}))

import MemberDetailModal from '@/components/modal/MemberDetailModal'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MemberDetailModal Editor Permissions', () => {
  it('forwards canEdit=true to MemberForm when Editor opens create member modal', () => {
    mockUseUser.mockReturnValue({
      user: { id: 'editor-1' },
      profile: { role: 'editor', is_active: true },
      isAdmin: false,
      isEditor: true,
      supabase: {}
    })
    mockUseMemberListView.mockReturnValue({
      memberModalId: null,
      setMemberModalId: vi.fn(),
      showCreateMember: true,
      setShowCreateMember: vi.fn(),
      showAvatar: true,
      setShowAvatar: vi.fn(),
      view: 'list',
      setView: vi.fn(),
      rootId: null,
      setRootId: vi.fn()
    })

    render(<MemberDetailModal />)

    const formSpy = screen.getByTestId('member-form-spy')
    expect(formSpy.textContent).toContain('canEdit:true')
  })
})