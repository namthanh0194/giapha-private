import { getSupabase, getIsAdmin } from '@/utils/supabase/queries'
import GalleryClient from '@/components/GalleryClient'
import { getGalleryStoragePath } from '@/utils/supabase/storage-path'

export const metadata = {
  title: 'Phòng trưng bày | Gia phả Nguyễn Đăng Tộc',
  description: 'Lưu giữ và chia sẻ hình ảnh, kỷ niệm dòng họ'
}

export default async function GalleryPage() {
  const supabase = await getSupabase()
  const isAdmin = await getIsAdmin()

  const { data: items } = await supabase
    .from('gallery_items')
    .select('*')
    .order('event_date', { ascending: false, nullsFirst: false })

  const signedItems = await Promise.all(
    (items || []).map(async (item) => {
      const storagePath = getGalleryStoragePath(item.image_url)
      const { data } = await supabase.storage
        .from('gallery')
        .createSignedUrl(storagePath, 60 * 60)

      return {
        ...item,
        image_url: data?.signedUrl || '',
        storage_path: storagePath
      }
    })
  )

  return (
    <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col p-4 sm:p-8'>
      <GalleryClient
        key={signedItems.length}
        initialItems={signedItems}
        isAdmin={isAdmin}
      />
    </main>
  )
}
