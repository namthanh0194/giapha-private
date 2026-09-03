'use client'

import { Gender, Person, PrivacyLevel } from '@/types'
import { createClient } from '@/utils/supabase/client'
import { AnimatePresence, motion, Variants } from 'framer-motion'
import {
  AlertCircle,
  Briefcase,
  Image as ImageIcon,
  Info,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Settings2,
  Trash2,
  User
} from 'lucide-react'
import { Lunar, Solar } from 'lunar-javascript'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateDescendantGenerationsAction, updateMemberAction } from '@/app/actions/member'
import Link from 'next/link'
import { removeAvatarAction, saveAvatarAction } from '@/app/actions/avatar'
import { getAvatarUrl } from '@/utils/avatar'

interface MemberFormProps {
  initialData?: Person
  isEditing?: boolean
  isAdmin?: boolean
  canEdit?: boolean
  /** Called with the saved person's ID after a successful save. Overrides default router.push. */
  onSuccess?: (personId: string) => void
  /** Called when user clicks Cancel. Overrides default router.back(). */
  onCancel?: () => void
}

export default function MemberForm({
  initialData,
  isEditing = false,
  isAdmin = false,
  canEdit = false,
  onSuccess,
  onCancel
}: MemberFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictState, setConflictState] = useState<{
    message: string
    currentVersion: number
    pendingPayload: Record<string, unknown>
  } | null>(null)
  const [showDraftDiff, setShowDraftDiff] = useState(false)
  const [observedVersion, setObservedVersion] = useState<number>(initialData?.version ?? 1)

  // Form states
  const [fullName, setFullName] = useState(initialData?.full_name || '')
  const [otherNames, setOtherNames] = useState(initialData?.other_names || '')
  const [gender, setGender] = useState<Gender>(initialData?.gender || 'male')
  const [birthYear, setBirthYear] = useState<number | ''>(
    initialData?.birth_year || ''
  )
  const [birthMonth, setBirthMonth] = useState<number | ''>(
    initialData?.birth_month || ''
  )
  const [birthDay, setBirthDay] = useState<number | ''>(
    initialData?.birth_day || ''
  )

  const [deathYear, setDeathYear] = useState<number | ''>(
    initialData?.death_year || ''
  )
  const [deathMonth, setDeathMonth] = useState<number | ''>(
    initialData?.death_month || ''
  )
  const [deathDay, setDeathDay] = useState<number | ''>(
    initialData?.death_day || ''
  )

  const [deathLunarYear, setDeathLunarYear] = useState<number | ''>(
    initialData?.death_lunar_year || ''
  )
  const [deathLunarMonth, setDeathLunarMonth] = useState<number | ''>(
    initialData?.death_lunar_month || ''
  )
  const [deathLunarDay, setDeathLunarDay] = useState<number | ''>(
    initialData?.death_lunar_day || ''
  )

  const [isDeceased, setIsDeceased] = useState<boolean>(
    initialData?.is_deceased || false
  )
  const [isInLaw, setIsInLaw] = useState<boolean>(
    initialData?.is_in_law || false
  )

  const [birthOrder, setBirthOrder] = useState<number | ''>(
    initialData?.birth_order || ''
  )
  const [generation, setGeneration] = useState<number | ''>(
    initialData?.generation || ''
  )

  const [updateDescendantGenerations, setUpdateDescendantGenerations] =
    useState(true) // Default to true if they change it

  const hasGenerationChanged =
    isEditing &&
    initialData?.generation !== undefined &&
    generation !== initialData?.generation &&
    generation !== ''

  const [avatarUrl, setAvatarUrl] = useState(initialData?.avatar_url || '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    initialData?.avatar_url || null
  )

  const [note, setNote] = useState(initialData?.note || '')
  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>(
    initialData?.privacy_level || 'family'
  )

  // Private fields
  const [phoneNumber, setPhoneNumber] = useState(
    initialData?.phone_number ?? ''
  )
  const [occupation, setOccupation] = useState(initialData?.occupation ?? '')
  const [currentResidence, setCurrentResidence] = useState(
    initialData?.current_residence ?? ''
  )

  const handleSolarDeathChange = (
    field: 'day' | 'month' | 'year',
    val: string
  ) => {
    const num = val ? Number(val) : ''
    let d = deathDay
    let m = deathMonth
    let y = deathYear

    if (field === 'day') {
      d = num
      setDeathDay(num)
    } else if (field === 'month') {
      m = num
      setDeathMonth(num)
    } else if (field === 'year') {
      y = num
      setDeathYear(num)
    }

    if (d !== '' && m !== '' && y !== '' && y > 100) {
      try {
        const solar = Solar.fromYmd(y, m, d)
        const lunar = solar.getLunar()
        setDeathLunarDay(lunar.getDay())
        setDeathLunarMonth(Math.abs(lunar.getMonth()))
        setDeathLunarYear(lunar.getYear())
      } catch {
        // Ignore invalid dates
      }
    }
  }

  const handleLunarDeathChange = (
    field: 'day' | 'month' | 'year',
    val: string
  ) => {
    const num = val ? Number(val) : ''
    let d = deathLunarDay
    let m = deathLunarMonth
    let y = deathLunarYear

    if (field === 'day') {
      d = num
      setDeathLunarDay(num)
    } else if (field === 'month') {
      m = num
      setDeathLunarMonth(num)
    } else if (field === 'year') {
      y = num
      setDeathLunarYear(num)
    }

    if (d !== '' && m !== '' && y !== '' && y > 100) {
      try {
        const lunar = Lunar.fromYmd(y, m, d)
        const solar = lunar.getSolar()
        setDeathDay(solar.getDay())
        setDeathMonth(solar.getMonth())
        setDeathYear(solar.getYear())
      } catch {
        // Ignore invalid dates
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Validation
    const isValidDate = (
      day: number | '',
      month: number | '',
      year: number | ''
    ) => {
      if (day !== '' && (day < 1 || day > 31)) return false
      if (month !== '' && (month < 1 || month > 12)) return false
      if (year !== '' && year < 1) return false

      if (day !== '' && month !== '') {
        const currentYear = year !== '' ? year : 2000
        const daysInMonth = new Date(currentYear, month, 0).getDate()
        if (day > daysInMonth) return false
      }
      return true
    }

    if (!isValidDate(birthDay, birthMonth, birthYear)) {
      setError('Ngày sinh không hợp lệ. Vui lòng kiểm tra lại.')
      setLoading(false)
      return
    }

    let finalDeathDay = deathDay
    let finalDeathMonth = deathMonth
    let finalDeathYear = deathYear
    let finalDeathLunarDay = deathLunarDay
    let finalDeathLunarMonth = deathLunarMonth
    let finalDeathLunarYear = deathLunarYear

    if (
      isDeceased &&
      deathLunarDay !== '' &&
      deathLunarMonth !== '' &&
      deathLunarYear !== '' &&
      (deathDay === '' || deathMonth === '' || deathYear === '')
    ) {
      try {
        const lunarDate = Lunar.fromYmd(
          deathLunarYear,
          deathLunarMonth,
          deathLunarDay
        )
        const solarDate = lunarDate.getSolar()
        finalDeathDay = solarDate.getDay()
        finalDeathMonth = solarDate.getMonth()
        finalDeathYear = solarDate.getYear()
      } catch {
        setError('Ngày âm lịch không hợp lệ. Vui lòng kiểm tra lại.')
        setLoading(false)
        return
      }
    } else if (
      isDeceased &&
      deathDay !== '' &&
      deathMonth !== '' &&
      deathYear !== '' &&
      (deathLunarDay === '' || deathLunarMonth === '' || deathLunarYear === '')
    ) {
      // Sync from Solar back to Lunar
      try {
        const solarDate = Solar.fromYmd(deathYear, deathMonth, deathDay)
        const lunarDate = solarDate.getLunar()
        finalDeathLunarDay = lunarDate.getDay()
        finalDeathLunarMonth = Math.abs(lunarDate.getMonth())
        finalDeathLunarYear = lunarDate.getYear()
      } catch {
        // Safe fallback if conversion fails
      }
    } else if (!isDeceased) {
      // Clear all
      finalDeathDay = ''
      finalDeathMonth = ''
      finalDeathYear = ''
      finalDeathLunarDay = ''
      finalDeathLunarMonth = ''
      finalDeathLunarYear = ''
    }

    if (
      isDeceased &&
      !isValidDate(finalDeathDay, finalDeathMonth, finalDeathYear)
    ) {
      setError('Ngày mất không hợp lệ. Vui lòng kiểm tra lại.')
      setLoading(false)
      return
    }

    if (
      isDeceased &&
      birthYear !== '' &&
      finalDeathYear !== '' &&
      finalDeathYear < birthYear
    ) {
      setError('Năm mất phải lớn hơn hoặc bằng năm sinh.')
      setLoading(false)
      return
    }

    try {
      const currentAvatarUrl = avatarUrl

      // Update person data helper to avoid duplication
      const getPersonData = (url: string | null) => ({
        full_name: fullName,
        gender,
        birth_year: birthYear === '' ? null : Number(birthYear),
        birth_month: birthMonth === '' ? null : Number(birthMonth),
        birth_day: birthDay === '' ? null : Number(birthDay),
        death_year:
          isDeceased && finalDeathYear !== '' ? Number(finalDeathYear) : null,
        death_month:
          isDeceased && finalDeathMonth !== '' ? Number(finalDeathMonth) : null,
        death_day:
          isDeceased && finalDeathDay !== '' ? Number(finalDeathDay) : null,
        death_lunar_year:
          isDeceased && finalDeathLunarYear !== ''
            ? Number(finalDeathLunarYear)
            : null,
        death_lunar_month:
          isDeceased && finalDeathLunarMonth !== ''
            ? Number(finalDeathLunarMonth)
            : null,
        death_lunar_day:
          isDeceased && finalDeathLunarDay !== ''
            ? Number(finalDeathLunarDay)
            : null,
        is_deceased: isDeceased,
        is_in_law: isInLaw,
        birth_order: birthOrder === '' ? null : Number(birthOrder),
        generation: generation === '' ? null : Number(generation),
        other_names: otherNames || null,
        avatar_url: url,
        note: note || null,
        privacy_level: privacyLevel
      })

      let currentPersonId = initialData?.id
      let currentPersonVersion = isEditing ? observedVersion : undefined

      // For a new member, we must insert first to get the ID for the avatar filename
      if (!isEditing || !currentPersonId) {
        const { data: newPerson, error: createError } = await supabase
          .from('persons')
          .insert(getPersonData(currentAvatarUrl || null))
          .select()
          .single()
        if (createError) throw createError
        currentPersonId = newPerson.id
        currentPersonVersion = newPerson.version
      } else {
        const payload = getPersonData(currentAvatarUrl || null)
        const updateResult = await updateMemberAction(
          currentPersonId,
          observedVersion,
          payload
        )

        if (!updateResult.success) {
          if (updateResult.conflict) {
            setConflictState({
              message: 'Dữ liệu đã được người khác cập nhật.',
              currentVersion: observedVersion,
              pendingPayload: payload
            })
            setLoading(false)
            return
          }
          throw new Error(
            updateResult.errorId
              ? updateResult.error + ' Mã sự cố: ' + updateResult.errorId
              : updateResult.error
          )
        }

        setObservedVersion(updateResult.version)
        currentPersonVersion = updateResult.version
        setConflictState(null)
      }

      // 2. Handle avatar storage through the server action.
      if (avatarFile && currentPersonId && currentPersonVersion) {
        const avatarResult = await saveAvatarAction(
          currentPersonId,
          avatarFile,
          currentPersonVersion
        )
        if (!avatarResult.success) {
          throw new Error(
            avatarResult.errorId
              ? avatarResult.error + ' Mã sự cố: ' + avatarResult.errorId
              : avatarResult.error || 'Không thể lưu ảnh đại diện.'
          )
        }
        setObservedVersion(avatarResult.version ?? currentPersonVersion)
      }

      // 3. Upsert private data (only if admin and currentPersonId exists)
      if (isAdmin && currentPersonId) {
        const normalizedData = {
          person_id: currentPersonId,
          phone_number: phoneNumber?.trim() || null,
          occupation: occupation?.trim() || null,
          current_residence: currentResidence?.trim() || null
        }

        const hasData =
          normalizedData.phone_number ||
          normalizedData.occupation ||
          normalizedData.current_residence

        if (hasData) {
          const { error } = await supabase
            .from('person_details_private')
            .upsert(normalizedData)

          if (error) throw error
        } else {
          const { error } = await supabase
            .from('person_details_private')
            .delete()
            .eq('person_id', currentPersonId)

          if (error) throw error
        }
      }

      // 4. Update descendants' generations if checked and changed
      if (
        hasGenerationChanged &&
        updateDescendantGenerations &&
        currentPersonId
      ) {
        const delta = Number(generation) - (initialData?.generation || 0)
        if (delta !== 0) {
          const res = await updateDescendantGenerationsAction(
            currentPersonId,
            delta
          )
          if (res.error) {
            console.error('Failed to update descendant generations:', res.error)
            // Non-blocking error, but we could show a toast if we had one
          }
        }
      }

      // After save: use callback if provided, otherwise fall back to page navigation

      if (!currentPersonId)
        throw new Error('Không lấy được ID thành viên sau khi lưu.')
      if (onSuccess) {
        onSuccess(currentPersonId)
      } else {
        router.push('/dashboard/members/' + currentPersonId)
        router.refresh()
      }
    } catch (err) {
      console.error('Error saving member:', err)
      setError((err as Error).message || 'Failed to save member')
    } finally {
      setLoading(false)
    }
  }

  const formSectionVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 300, damping: 24 }
    }
  }

  const inputClasses =
    'bg-white text-stone-900 placeholder-stone-500 block w-full rounded-xl border border-stone-300  focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:bg-white text-sm px-4 py-3 transition-all outline-none!'

  return (
    <form onSubmit={handleSubmit} className='space-y-6 sm:space-y-8'>
      <motion.div
        variants={formSectionVariants}
        initial='hidden'
        animate='show'
        className='rounded-2xl border border-stone-200/80 bg-white/80 p-5 sm:p-8'>
        <h3 className='mb-6 flex items-center gap-2 border-b border-stone-100 pb-4 font-serif text-lg font-semibold text-stone-800 sm:text-xl'>
          <User className='size-5 text-amber-600' />
          Thông tin chung
        </h3>
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          <div className='md:col-span-1'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              Họ và Tên <span className='text-red-500'>*</span>
            </label>
            <input
              type='text'
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClasses}
              placeholder='Nhập họ và tên...'
            />
          </div>

          <div className='md:col-span-1'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              Tên gọi khác
            </label>
            <input
              type='text'
              value={otherNames}
              onChange={(e) => setOtherNames(e.target.value)}
              className={inputClasses}
              placeholder='Nickname, tên thánh, bí danh...'
            />
          </div>

          <div>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              Giới tính <span className='text-red-500'>*</span>
            </label>
            <div className='relative'>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
                className={`${inputClasses} appearance-none`}>
                <option value='male'>Nam</option>
                <option value='female'>Nữ</option>
                <option value='other'>Khác</option>
              </select>
              <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-stone-500'>
                <Settings2 className='size-4' />
              </div>
            </div>
          </div>

          <div className='mt-2 flex items-center sm:mt-7'>
            <label className='group flex items-center gap-3'>
              <div className='relative flex items-center'>
                <input
                  type='checkbox'
                  checked={isInLaw}
                  onChange={(e) => setIsInLaw(e.target.checked)}
                  className='peer sr-only'
                />
                <div className='flex size-5 items-center justify-center rounded border-2 border-stone-300 transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-500'>
                  <motion.svg
                    initial={false}
                    animate={{
                      opacity: isInLaw ? 1 : 0,
                      scale: isInLaw ? 1 : 0.5
                    }}
                    className='pointer-events-none size-3 text-white'
                    fill='none'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                    strokeWidth={4}>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      d='M5 13l4 4L19 7'
                    />
                  </motion.svg>
                </div>
              </div>
              <span className='text-sm font-medium text-stone-700 transition-colors group-hover:text-amber-700'>
                Là con Dâu hoặc con Rể
              </span>
            </label>
          </div>

          <div>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              Thứ tự sinh trong gia đình
            </label>
            <input
              type='number'
              min='1'
              placeholder='Ví dụ: 1 (con trưởng), 2 (con thứ hai)...'
              value={birthOrder}
              onChange={(e) =>
                setBirthOrder(e.target.value ? Number(e.target.value) : '')
              }
              className={inputClasses}
            />
            <p className='mt-1.5 flex items-center gap-1 text-sm text-stone-400'>
              <Info className='size-3.5 text-stone-400' aria-hidden='true' /> Để trống nếu không rõ
            </p>
          </div>

          <div>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              Thuộc đời thứ
            </label>
            <input
              type='number'
              min='1'
              placeholder='Ví dụ: 1, 2, 3...'
              value={generation}
              onChange={(e) =>
                setGeneration(e.target.value ? Number(e.target.value) : '')
              }
              className={inputClasses}
            />
            <p className='mt-1.5 flex items-center gap-1 text-sm text-stone-400'>
              <Info className='size-3.5 text-stone-400' aria-hidden='true' /> Để trống nếu không rõ
            </p>

            <AnimatePresence>
              {hasGenerationChanged && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className='overflow-hidden'>
                  <label className='group flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200/60 bg-amber-50/50 p-3'>
                    <div className='relative mt-0.5 flex items-center'>
                      <input
                        type='checkbox'
                        checked={updateDescendantGenerations}
                        onChange={(e) =>
                          setUpdateDescendantGenerations(e.target.checked)
                        }
                        className='peer sr-only'
                      />
                      <div className='flex size-4 items-center justify-center rounded border-2 border-stone-300 transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-500 sm:size-5'>
                        <motion.svg
                          initial={false}
                          animate={{
                            opacity: updateDescendantGenerations ? 1 : 0,
                            scale: updateDescendantGenerations ? 1 : 0.5
                          }}
                          className='pointer-events-none size-3 text-white'
                          fill='none'
                          viewBox='0 0 24 24'
                          stroke='currentColor'
                          strokeWidth={4}>
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            d='M5 13l4 4L19 7'
                          />
                        </motion.svg>
                      </div>
                    </div>
                    <div className='flex-1'>
                      <span className='block text-sm font-medium text-stone-700 transition-colors group-hover:text-amber-700'>
                        Cập nhật đời cho các thế hệ sau
                      </span>
                      <p className='mt-1 text-sm text-stone-500'>
                        Tự động điều chỉnh đời của con, cháu... tương ứng với
                        thay đổi này.
                      </p>
                    </div>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className='mt-2 md:col-span-2'>
            <label className='mb-2.5 block text-sm font-medium text-stone-700'>
              Ảnh đại diện
            </label>
            <div className='flex flex-col items-start gap-5 rounded-xl border border-stone-100 bg-stone-50/50 p-4 sm:flex-row sm:items-center'>
              <div
                className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white text-sm font-medium text-white sm:h-24 sm:w-24 ${!avatarPreview ? (gender === 'male' ? 'bg-linear-to-br from-sky-400 to-sky-700' : gender === 'female' ? 'bg-linear-to-br from-rose-400 to-rose-700' : 'bg-linear-to-br from-stone-400 to-stone-600') : ''}`}>
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      avatarPreview.startsWith('blob:')
                        ? avatarPreview
                        : getAvatarUrl(avatarPreview) || undefined
                    }
                    alt='Avatar preview'
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <span className='opacity-90'>
                    {fullName ? fullName.charAt(0).toUpperCase() : '?'}
                  </span>
                )}
              </div>
              <div className='w-full flex-1'>
                <div className='flex flex-wrap items-center gap-3'>
                  <div className='relative'>
                    <input
                      type='file'
                      accept='image/*'
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          if (
                            ![
                              'image/jpeg',
                              'image/png',
                              'image/gif',
                              'image/webp'
                            ].includes(file.type)
                          ) {
                            setError(
                              'Ảnh phải có định dạng JPG, PNG, GIF hoặc WebP.'
                            )
                            return
                          }
                          if (file.size > 2 * 1024 * 1024) {
                            setError('Ảnh không được vượt quá 2MB.')
                            return
                          }
                          setAvatarFile(file)
                          setAvatarPreview(URL.createObjectURL(file))
                        }
                      }}
                      className='absolute inset-0 h-full w-full opacity-0'
                    />
                    <button
                      type='button'
                      className='flex min-h-11 items-center gap-2 rounded-lg border border-amber-200/50 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100'>
                      <ImageIcon className='size-4' />
                      Chọn ảnh mới
                    </button>
                  </div>
                  {avatarPreview && (
                    <button
                      type='button'
                      onClick={async () => {
                        if (initialData?.id && avatarUrl) {
                          const result = await removeAvatarAction(
                            initialData.id,
                            observedVersion
                          )
                          if (!result.success) {
                            setError(
                              result.errorId
                                ? result.error + ' Mã sự cố: ' + result.errorId
                                : result.error || 'Không thể gỡ ảnh đại diện.'
                            )
                            return
                          }
                          setObservedVersion(result.version ?? observedVersion)
                        }

                        setAvatarUrl('')
                        setAvatarFile(null)
                        setAvatarPreview(null)
                      }}
                      className='flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700'>
                      <Trash2 className='size-4' />
                      Xóa ảnh
                    </button>
                  )}
                </div>
                <p className='mt-2.5 flex items-center gap-1.5 text-sm text-stone-500'>
                  <AlertCircle className='h-3.5 w-3.5 text-stone-400' />
                  Hỗ trợ PNG, JPG, GIF tối đa 2MB.
                </p>
              </div>
            </div>
          </div>

          <div className='md:col-span-2'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              Ngày sinh dương lịch
            </label>
            <div className='grid grid-cols-3 gap-3'>
              <input
                type='number'
                placeholder='Ngày'
                min='1'
                max='31'
                value={birthDay}
                onChange={(e) =>
                  setBirthDay(e.target.value ? Number(e.target.value) : '')
                }
                className={inputClasses}
              />
              <input
                type='number'
                placeholder='Tháng'
                min='1'
                max='12'
                value={birthMonth}
                onChange={(e) =>
                  setBirthMonth(e.target.value ? Number(e.target.value) : '')
                }
                className={inputClasses}
              />
              <input
                type='number'
                placeholder='Năm'
                value={birthYear}
                onChange={(e) =>
                  setBirthYear(e.target.value ? Number(e.target.value) : '')
                }
                className={inputClasses}
              />
            </div>
          </div>

          <div className='rounded-2xl border border-stone-200/60 bg-stone-50/50 p-5 md:col-span-2'>
            <div className='flex flex-col gap-4'>
              <label className='group flex items-center gap-3'>
                <div className='relative flex items-center'>
                  <input
                    type='checkbox'
                    checked={isDeceased}
                    onChange={(e) => {
                      setIsDeceased(e.target.checked)
                      if (!e.target.checked) {
                        setDeathYear('')
                        setDeathMonth('')
                        setDeathDay('')
                        setDeathLunarYear('')
                        setDeathLunarMonth('')
                        setDeathLunarDay('')
                      }
                    }}
                    className='peer sr-only'
                  />
                  <div className='flex size-5 items-center justify-center rounded border-2 border-stone-300 transition-colors peer-checked:border-stone-600 peer-checked:bg-stone-600'>
                    <motion.svg
                      initial={false}
                      animate={{
                        opacity: isDeceased ? 1 : 0,
                        scale: isDeceased ? 1 : 0.5
                      }}
                      className='pointer-events-none size-3 text-white'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                      strokeWidth={4}>
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        d='M5 13l4 4L19 7'
                      />
                    </motion.svg>
                  </div>
                </div>
                <span className='text-sm font-medium text-stone-700 transition-colors group-hover:text-stone-900'>
                  Đã mất
                </span>
              </label>
            </div>

            <AnimatePresence>
              {isDeceased && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className='overflow-hidden'>
                  <p className='mb-4 text-sm text-stone-500 italic'>
                    * Nhập Ngày Dương lịch hoặc Ngày Âm lịch. Hệ thống sẽ tự
                    động tính toán và điền phần còn lại.
                  </p>

                  <div className='flex flex-col gap-5'>
                    {/* Lunar Date */}
                    <div>
                      <label className='mb-2 block text-sm font-medium text-stone-700'>
                        Ngày mất (Âm lịch)
                      </label>
                      <div className='grid grid-cols-3 gap-3'>
                        <input
                          type='number'
                          placeholder='Ngày'
                          min='1'
                          max='31'
                          value={deathLunarDay}
                          onChange={(e) =>
                            handleLunarDeathChange('day', e.target.value)
                          }
                          className={inputClasses}
                        />
                        <input
                          type='number'
                          placeholder='Tháng'
                          min='1'
                          max='12'
                          value={deathLunarMonth}
                          onChange={(e) =>
                            handleLunarDeathChange('month', e.target.value)
                          }
                          className={inputClasses}
                        />
                        <input
                          type='number'
                          placeholder='Năm'
                          value={deathLunarYear}
                          onChange={(e) =>
                            handleLunarDeathChange('year', e.target.value)
                          }
                          className={inputClasses}
                        />
                      </div>
                    </div>

                    {/* Solar Date */}
                    <div>
                      <label className='mb-2 block text-sm font-medium text-stone-700'>
                        Ngày mất (Dương lịch)
                      </label>
                      <div className='grid grid-cols-3 gap-3'>
                        <input
                          type='number'
                          placeholder='Ngày'
                          min='1'
                          max='31'
                          value={deathDay}
                          onChange={(e) =>
                            handleSolarDeathChange('day', e.target.value)
                          }
                          className={inputClasses}
                        />
                        <input
                          type='number'
                          placeholder='Tháng'
                          min='1'
                          max='12'
                          value={deathMonth}
                          onChange={(e) =>
                            handleSolarDeathChange('month', e.target.value)
                          }
                          className={inputClasses}
                        />
                        <input
                          type='number'
                          placeholder='Năm'
                          value={deathYear}
                          onChange={(e) =>
                            handleSolarDeathChange('year', e.target.value)
                          }
                          className={inputClasses}
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className='md:col-span-2'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              Ghi chú
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Thêm thông tin bổ sung, tiểu sử...'
              className={`${inputClasses} resize-none`}
            />
          </div>
        </div>
      </motion.div>

      {canEdit && (
        <motion.div
          variants={formSectionVariants}
          initial='hidden'
          animate='show'
          transition={{ delay: 0.1 }}
          className='rounded-2xl border border-stone-200 bg-stone-50 p-5 sm:p-6'>
          <h3 className='flex items-center gap-2 text-base font-semibold text-stone-900'>
            <Lock className='size-4 text-amber-700' />
            Quyền riêng tư hồ sơ
          </h3>
          <p className='mt-1.5 text-sm text-stone-600'>
            Chọn người được xem toàn bộ hồ sơ này. Dữ liệu và quan hệ liên quan
            sẽ không hiển thị cho người không có quyền.
          </p>
          <label className='mt-4 block text-sm font-medium text-stone-700'>
            Mức hiển thị
          </label>
          <select
            value={privacyLevel}
            onChange={(event) =>
              setPrivacyLevel(event.target.value as PrivacyLevel)
            }
            className={`${inputClasses} mt-1.5`}>
            <option value='family'>
              Gia đình — mọi tài khoản đang hoạt động
            </option>
            <option value='editors'>
              Biên tập viên — quản trị viên và biên tập viên
            </option>
            <option value='admins'>Quản trị viên — chỉ quản trị viên</option>
          </select>
        </motion.div>
      )}

      {/* Private Information Section (Admin Only) */}
      {isAdmin && (
        <motion.div
          variants={formSectionVariants}
          initial='hidden'
          animate='show'
          transition={{ delay: 0.1 }}
          className='relative overflow-hidden rounded-2xl border border-amber-200/50 bg-linear-to-br from-amber-50/80 to-stone-50/80 p-5 sm:p-8'>
          {/* Decorative Background Icon */}
          <Lock className='absolute -right-6 -bottom-6 h-32 w-32 rotate-12 text-amber-500/5' />

          <h3 className='relative z-10 mb-6 flex items-center gap-2 border-b border-amber-200/50 pb-4 font-serif text-lg font-semibold text-amber-900 sm:text-xl'>
            <span className='rounded-lg bg-amber-100/80 p-1.5 text-amber-700 shadow-xs'>
              <Lock className='size-4' />
            </span>
            <span>Thông tin riêng tư</span>
            <span className='ml-auto rounded-md border border-amber-300/60 bg-amber-200/80 px-2.5 py-1 text-sm font-medium text-amber-800 sm:ml-2'>
              Chỉ Admin
            </span>
          </h3>
          <div className='relative z-10 grid grid-cols-1 gap-6 md:grid-cols-2'>
            <div>
              <label className='mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-900/80'>
                <Phone className='size-4' /> Số điện thoại
              </label>
              <input
                type='tel'
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={isDeceased}
                placeholder='Ví dụ: 0912345678'
                className={`${inputClasses} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400`}
              />
              {isDeceased && (
                <p className='mt-1.5 flex items-center gap-1 text-sm font-medium text-rose-500'>
                  <AlertCircle className='size-3' />
                  Không thể nhập SĐT cho người đã mất
                </p>
              )}
            </div>

            <div>
              <label className='mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-900/80'>
                <Briefcase className='size-4' /> Nghề nghiệp
              </label>
              <input
                type='text'
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                placeholder='Ví dụ: Kỹ sư, Bác sĩ...'
                className={inputClasses}
              />
            </div>

            <div className='md:col-span-2'>
              <label className='mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-900/80'>
                <MapPin className='size-4' /> Nơi ở hiện tại
              </label>
              <input
                type='text'
                value={currentResidence}
                onChange={(e) => setCurrentResidence(e.target.value)}
                placeholder='Địa chỉ cư trú...'
                className={inputClasses}
              />
            </div>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className='flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700'>
            <AlertCircle className='mt-0.5 size-5 shrink-0' />
            <p>{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {conflictState && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            aria-live='assertive'
            className='rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-stone-800 sm:p-6'>
            <div className='flex items-start gap-3'>
              <AlertCircle className='mt-0.5 size-5 shrink-0 text-rose-600' />
              <div className='space-y-3'>
                <p className='font-medium text-rose-800'>
                  Dữ liệu đã được người khác cập nhật.
                </p>
                <div className='flex flex-wrap items-center gap-3'>
                  <button
                    type='button'
                    onClick={() => {
                      router.refresh()
                      if (initialData?.id) {
                        router.push('/dashboard/members/' + initialData.id + '/edit')
                      }
                      setConflictState(null)
                      setShowDraftDiff(false)
                    }}
                    className='btn-primary text-sm'>
                    Tải phiên bản mới
                  </button>
                  <button
                    type='button'
                    onClick={() => setShowDraftDiff((prev) => !prev)}
                    className='btn text-sm'>
                    Xem thay đổi của bạn
                  </button>
                  {(isAdmin || canEdit) && (
                    <Link
                      href={'/dashboard/activity?table=persons'}
                      className='inline-flex items-center text-sm font-medium text-amber-700 underline decoration-amber-700/30 underline-offset-4 hover:text-amber-800'>
                      Xem lịch sử thay đổi
                    </Link>
                  )}
                </div>

                {showDraftDiff && (
                  <div className='mt-3 rounded-xl border border-stone-200 bg-white p-4 text-xs sm:text-sm text-stone-700 space-y-1'>
                    <p className='font-medium text-stone-900'>Thay đổi chưa lưu của bạn:</p>
                    <p>Họ và tên: {fullName}</p>
                    <p>Tên khác: {otherNames || '(trống)'}</p>
                    <p>Giới tính: {gender}</p>
                    <p>Năm sinh: {birthYear || '(trống)'}</p>
                    <p>Ghi chú: {note || '(trống)'}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <motion.div
        variants={formSectionVariants}
        initial='hidden'
        animate='show'
        transition={{ delay: 0.2 }}
        className='flex justify-end gap-3 pt-6 sm:gap-4'>
        <button
          type='button'
          onClick={() => (onCancel ? onCancel() : router.back())}
          className='btn'>
          Hủy bỏ
        </button>
        <button type='submit' disabled={loading} className='btn-primary'>
          {loading && <Loader2 className='size-4 animate-spin' />}
          {loading
            ? 'Đang lưu...'
            : isEditing
              ? 'Lưu thay đổi'
              : 'Thêm thành viên'}
        </button>
      </motion.div>
    </form>
  )
}
