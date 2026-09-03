/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const memberListView = vi.hoisted(() => ({ setMemberModalId: vi.fn() }))

vi.mock('@/context/MemberListContext', () => ({
  useMemberListView: () => memberListView
}))

vi.mock('@/app/actions/gallery', () => ({
  deleteGalleryItemAction: vi.fn()
}))

import GalleryGrid from '@/components/GalleryGrid'
import PersonCard from '@/components/PersonCard'

afterEach(() => {
  cleanup()
  memberListView.setMemberModalId.mockReset()
})

describe('keyboard navigation', () => {
  it('opens a gallery item with Enter using its native button', async () => {
    const user = userEvent.setup()
    render(
      <GalleryGrid
        items={[
          {
            id: 'gallery-1',
            title: 'Lễ mừng thọ',
            description: null,
            image_url: '/photo.jpg',
            event_date: null,
            created_at: '2026-09-02T00:00:00.000Z',
            created_by: null
          }
        ]}
      />
    )

    const item = screen.getByRole('button', { name: 'Lễ mừng thọ' })
    item.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog', { name: 'Lễ mừng thọ' })).toBeTruthy()
  })

  it('opens a member card with Space using its native button', async () => {
    const user = userEvent.setup()
    render(
      <PersonCard
        person={{
          id: 'person-1',
          full_name: 'Nguyễn Văn An',
          gender: 'male',
          birth_year: 1950,
          birth_month: null,
          birth_day: null,
          death_year: null,
          death_month: null,
          death_day: null,
          avatar_url: null,
          note: null,
          created_at: '2026-09-02T00:00:00.000Z',
          updated_at: '2026-09-02T00:00:00.000Z',
          death_lunar_year: null,
          death_lunar_month: null,
          death_lunar_day: null,
          is_deceased: false,
          is_in_law: false,
          birth_order: null,
          generation: null,
          other_names: null
        }}
      />
    )

    const card = screen.getByRole('button', { name: /nguyễn văn an/i })
    card.focus()
    await user.keyboard(' ')

    expect(memberListView.setMemberModalId).toHaveBeenCalledWith('person-1')
  })
})
