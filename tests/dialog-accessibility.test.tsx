/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/gallery', () => ({
  deleteGalleryItemAction: vi.fn()
}))

vi.mock('@/app/actions/member', () => ({
  deleteCustomEventAction: vi.fn(),
  updateCustomEventAction: vi.fn()
}))

vi.mock('@/utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn(() => new Promise(() => {})),
      update: vi.fn(() => new Promise(() => {})),
      delete: vi.fn(() => new Promise(() => {}))
    }))
  }))
}))

import CustomEventModal from '@/components/modal/CustomEventModal'
import DialogShell from '@/components/modal/DialogShell'
import GalleryGrid from '@/components/GalleryGrid'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('DialogShell', () => {
  it('provides dialog semantics, focuses inside, traps tab, and inerts the background', async () => {
    const user = userEvent.setup()
    const trigger = document.createElement('button')
    trigger.textContent = 'Mở hộp thoại'
    document.body.append(trigger)
    trigger.focus()

    render(
      <DialogShell title='Thêm hình ảnh' onClose={vi.fn()}>
        <button type='button'>Đầu tiên</button>
        <button type='button'>Cuối cùng</button>
      </DialogShell>
    )

    const dialog = document.querySelector('[role="dialog"]')
    const firstButton = dialog?.querySelector('button')
    const lastButton = dialog?.querySelectorAll('button')[1]

    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.body.firstElementChild?.hasAttribute('inert')).toBe(true)

    await waitFor(() => expect(document.activeElement).toBe(firstButton))

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(lastButton)

    await user.keyboard('{Tab}')
    expect(document.activeElement).toBe(firstButton)
  })

  it('closes with Escape when safe and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = 'Mở hộp thoại'
    document.body.append(trigger)
    trigger.focus()

    const view = render(
      <DialogShell title='Thêm hình ảnh' onClose={onClose}>
        <button type='button'>Đầu tiên</button>
      </DialogShell>
    )

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()

    view.unmount()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('does not close with Escape while closing is unsafe', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <DialogShell title='Đang tải ảnh' onClose={onClose} canClose={false}>
        <button type='button'>Đầu tiên</button>
      </DialogShell>
    )

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders GalleryGrid lightbox within a full DialogShell', async () => {
    const user = userEvent.setup()
    render(
      <GalleryGrid
        items={[
          {
            id: 'gallery-1',
            title: 'Lễ mừng thọ',
            description: 'Ảnh kỷ niệm',
            image_url: '/photo.jpg',
            event_date: null,
            created_at: '2026-09-02T00:00:00.000Z',
            created_by: null
          }
        ]}
      />
    )

    const item = screen.getByRole('button', { name: 'Lễ mừng thọ' })
    await user.click(item)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('disables close actions in CustomEventModal while submission is in flight', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <CustomEventModal
        isOpen={true}
        onClose={onClose}
        onSuccess={vi.fn()}
        canEdit={true}
      />
    )

    const nameInput = screen.getByPlaceholderText('VD: Lễ Tảo Mộ Kỷ Tỵ')
    await user.type(nameInput, 'Họp mặt Họ')

    const saveButton = screen.getByRole('button', { name: 'Lưu sự kiện' })
    await user.click(saveButton)

    const closeHeaderButton = screen.getByRole('button', {
      name: 'Đóng hộp thoại sự kiện'
    })
    expect(closeHeaderButton.hasAttribute('disabled')).toBe(true)

    await user.click(closeHeaderButton)
    expect(onClose).not.toHaveBeenCalled()
  })
})
