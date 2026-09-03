export interface FooterProps {
  className?: string
  showDisclaimer?: boolean
}

export default function Footer({
  className = '',
  showDisclaimer = false
}: FooterProps) {
  return (
    <footer
      className={`py-8 text-center text-sm text-stone-500 ${className} backdrop-blur-sm`}>
      <div className='mx-auto max-w-7xl px-4'>
        {showDisclaimer && (
          <p className='mb-4 inline-block rounded-full border border-amber-200/50 bg-amber-50 px-3 py-1 text-sm text-amber-800/80'>
            Nội dung có thể thiếu sót. Vui lòng đóng góp để gia phả chính xác
            hơn.
          </p>
        )}
        <p className='flex items-center justify-center gap-2 opacity-80 transition-opacity hover:opacity-100'>
          <a
            href='https://www.facebook.com/nampalmyran'
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex min-h-11 items-center gap-1.5 font-medium text-stone-600 transition-colors hover:text-amber-700'>
            Design by NamNt
          </a>
        </p>
      </div>
    </footer>
  )
}
