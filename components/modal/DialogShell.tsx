'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface DialogShellProps {
  children: ReactNode
  title: string
  onClose: () => void
  canClose?: boolean
  description?: string
  maxWidthClass?: string
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function DialogShell({
  children,
  title,
  onClose,
  canClose = true,
  description,
  maxWidthClass = 'max-w-4xl'
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusedElement = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const canCloseRef = useRef(canClose)
  const titleId = useId()
  const descriptionId = useId()

  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    onCloseRef.current = onClose
    canCloseRef.current = canClose
  }, [onClose, canClose])

  useEffect(() => {
    previousFocusedElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const hiddenElements = Array.from(document.body.children)
      .filter((element) => !element.contains(dialogRef.current))
      .map((element) => ({
        element,
        hadInert: element.hasAttribute('inert'),
        previousAriaHidden: element.getAttribute('aria-hidden')
      }))

    hiddenElements.forEach(({ element }) => {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    })

    const frame = window.requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR
      )
      if (focusable?.length) {
        focusable[0].focus()
      } else {
        dialogRef.current?.focus()
      }
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (canCloseRef.current) {
          event.preventDefault()
          onCloseRef.current()
        }
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      )
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow

      hiddenElements.forEach(
        ({ element, hadInert, previousAriaHidden }) => {
          if (!hadInert) element.removeAttribute('inert')
          if (previousAriaHidden === null) {
            element.removeAttribute('aria-hidden')
          } else {
            element.setAttribute('aria-hidden', previousAriaHidden)
          }
        }
      )

      previousFocusedElement.current?.focus()
    }
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      <div className='fixed inset-0 z-100 flex items-center justify-center p-4 sm:p-6'>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className='absolute inset-0 bg-stone-900/40 backdrop-blur-sm'
          onClick={() => canCloseRef.current && onCloseRef.current()}
          aria-hidden='true'
        />
        <motion.div
          ref={dialogRef}
          role='dialog'
          aria-modal='true'
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          initial={{ scale: 0.96, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 15 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className={
            'relative flex max-h-[90vh] w-full ' +
            maxWidthClass +
            ' flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white/95 backdrop-blur-2xl focus:outline-none'
          }>
          <h2 id={titleId} className='sr-only'>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className='sr-only'>
              {description}
            </p>
          )}
          {children}
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  )
}
