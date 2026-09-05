import type { TreePreviewData } from '@/utils/treePreview'

export default function HomepageTreePreview({
  data
}: {
  data: TreePreviewData
}) {
  if (!data.ancestor) {
    return (
      <p className='p-6 text-sm text-stone-300'>
        Chưa có dữ liệu phả hệ để hiển thị.
      </p>
    )
  }

  return (
    <div className='min-w-[520px]'>
      <div className='mx-auto w-48 rounded-xl bg-amber-100 p-3 text-center text-primary'>
        <p className='text-sm font-medium'>Đời thứ nhất</p>
        <p className='mt-1 truncate text-sm text-secondary'>
          {data.ancestor.full_name}
        </p>
      </div>
      {data.gen2.length > 0 && (
        <div className='mx-auto h-8 w-px bg-amber-300' />
      )}
      <div
        className='grid gap-3'
        style={{
          gridTemplateColumns: `repeat(${Math.min(data.gen2.length || 1, 3)}, minmax(0, 1fr))`
        }}>
        {data.gen2.map((person) => (
          <div
            key={person.id}
            className='rounded-xl bg-white p-3 text-center text-primary'>
            <p className='text-sm font-medium'>Đời thứ hai</p>
            <p className='mt-1 truncate text-sm text-secondary'>
              {person.full_name}
            </p>
          </div>
        ))}
      </div>
      {data.gen3.length > 0 && (
        <div className='mt-5 grid grid-cols-3 gap-3'>
          {data.gen3.map((person) => (
            <div
              key={person.id}
              className='rounded-xl bg-white/10 p-3 text-center'>
              <p className='truncate text-sm'>{person.full_name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
