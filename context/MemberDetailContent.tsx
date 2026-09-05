'use client'

import DefaultAvatar from '@/components/DefaultAvatar'
import RelationshipManager from '@/components/RelationshipManager'
import SourcesManager from '@/components/SourcesManager'
import { Person } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'
import {
  calculateAge,
  formatDisplayDate,
  getLunarDateString,
  getSolarDateString,
  getZodiacAnimal,
  getZodiacSign
} from '@/utils/dateHelpers'
import { motion, Variants } from 'framer-motion'
import {
  Baby,
  Briefcase,
  ChevronDown,
  Info,
  Leaf,
  Lock,
  MapPin,
  Phone,
  UserPlus,
  Users
} from 'lucide-react'
import Image from 'next/image'
import { useCallback, useState } from 'react'
import { FemaleIcon, MaleIcon } from '@/components/GenderIcons'

interface MemberDetailContentProps {
  person: Person
  privateData: Record<string, unknown> | null
  isAdmin: boolean
  canEdit?: boolean
}

export default function MemberDetailContent({
  person,
  privateData,
  isAdmin,
  canEdit = false
}: MemberDetailContentProps) {
  const [isNoteExpanded, setIsNoteExpanded] = useState(false)
  const [relStats, setRelStats] = useState<{
    biologicalChildren: number
    maleBiologicalChildren: number
    femaleBiologicalChildren: number
    paternalGrandchildren: number
    maternalGrandchildren: number
    sonInLaw: number
    daughterInLaw: number
  } | null>(null)

  const handleStatsLoaded = useCallback(
    (stats: {
      biologicalChildren: number
      maleBiologicalChildren: number
      femaleBiologicalChildren: number
      paternalGrandchildren: number
      maternalGrandchildren: number
      sonInLaw: number
      daughterInLaw: number
    }) => {
      setRelStats(stats)
    },
    []
  )

  const fullPerson = { ...person, ...privateData }
  const note = (fullPerson.note as string) || ''
  const isNoteLong = note.length > 300

  const isDeceased =
    person.is_deceased ||
    !!person.death_year ||
    !!person.death_month ||
    !!person.death_day ||
    !!person.death_lunar_year ||
    !!person.death_lunar_month ||
    !!person.death_lunar_day

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  }

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 200, damping: 20 }
    }
  }

  return (
    <motion.div
      layout
      variants={containerVariants}
      initial='hidden'
      animate='show'
      className='bg-stone-50/50'>
      {/* Header / Cover */}
      <div className='relative h-28 shrink-0 bg-linear-to-r from-stone-200 via-stone-100 to-stone-200 sm:h-36'>
        {/* Decorative blur in cover */}
        <div
          className={`absolute -top-20 right-0 h-64 w-64 rounded-full opacity-40 blur-[60px] ${person.gender === 'male' ? 'bg-sky-300' : person.gender === 'female' ? 'bg-rose-300' : 'bg-stone-300'}`}
        />
        <div className='absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-amber-200 opacity-20 blur-[60px]' />

        <motion.div
          variants={itemVariants}
          className='absolute -bottom-12 left-6 z-10 sm:-bottom-16 sm:left-8'>
          <div
            className={`flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white text-sm font-medium text-white sm:h-32 sm:w-32 sm:border-[6px] sm:text-sm ${
              person.gender === 'male'
                ? 'bg-linear-to-br from-sky-400 to-sky-700'
                : person.gender === 'female'
                  ? 'bg-linear-to-br from-rose-400 to-rose-700'
                  : 'bg-linear-to-br from-stone-400 to-stone-600'
            }`}>
            {getAvatarUrl(person.avatar_url) ? (
              <Image
                unoptimized
                src={getAvatarUrl(person.avatar_url)!}
                alt={person.full_name}
                width={128}
                height={128}
                className='h-full w-full object-cover'
              />
            ) : (
              <DefaultAvatar gender={person.gender} size={128} />
            )}
          </div>
          {/* Gender Indicator Icon */}
          <div
            className={`absolute right-1 bottom-1 flex size-6 items-center justify-center rounded-full shadow-md ring-2 ring-white sm:right-2 sm:bottom-2 sm:size-8 sm:ring-4 ${
              person.gender === 'male'
                ? 'bg-sky-100 text-sky-600'
                : person.gender === 'female'
                  ? 'bg-rose-100 text-rose-600'
                  : 'bg-stone-100 text-stone-600'
            }`}>
            {person.gender === 'male' ? (
              <MaleIcon className='size-4 sm:size-5' />
            ) : person.gender === 'female' ? (
              <FemaleIcon className='size-4 sm:size-5' />
            ) : null}
          </div>
        </motion.div>
      </div>

      <div className='relative z-10 px-6 pt-16 pb-8 sm:px-8 sm:pt-20'>
        <motion.div
          variants={itemVariants}
          className='flex flex-col items-start justify-between sm:flex-row sm:items-center'>
          <div>
            <h1 className='flex flex-wrap items-center gap-2 font-serif text-2xl font-semibold text-stone-900 sm:gap-3 sm:text-3xl'>
              {fullPerson.full_name}
              {isDeceased && (
                <span className='rounded-md border border-stone-200/80 bg-stone-100/50 px-2 py-0.5 font-sans text-sm font-medium whitespace-nowrap text-stone-500 sm:text-sm'>
                  Đã mất
                </span>
              )}
              {person.is_in_law && (
                <span
                  className={`rounded-md border px-2 py-0.5 font-sans text-sm font-medium whitespace-nowrap sm:text-sm ${
                    person.gender === 'female'
                      ? 'border-rose-200/60 bg-rose-50/50 text-rose-700'
                      : person.gender === 'male'
                        ? 'border-sky-200/60 bg-sky-50/50 text-sky-700'
                        : 'border-stone-200/60 bg-stone-50/50 text-stone-700'
                  }`}>
                  {person.gender === 'female'
                    ? 'Dâu'
                    : person.gender === 'male'
                      ? 'Rể'
                      : 'Khách'}
                </span>
              )}
              {person.birth_order != null && (
                <span className='rounded-md border border-amber-200/60 bg-amber-50/60 px-2 py-0.5 font-sans text-sm font-medium whitespace-nowrap text-amber-700 sm:text-sm'>
                  {person.birth_order === 1
                    ? 'Con trưởng'
                    : `Con thứ ${person.birth_order}`}
                </span>
              )}
              {person.generation != null && (
                <span className='rounded-md border border-emerald-200/60 bg-emerald-50/60 px-2 py-0.5 font-sans text-sm font-medium whitespace-nowrap text-emerald-700 sm:text-sm'>
                  Đời thứ {person.generation}
                </span>
              )}
              {canEdit && (
                <span className='rounded-md border border-amber-200/60 bg-amber-50/60 px-2 py-0.5 font-sans text-sm font-medium whitespace-nowrap text-amber-700'>
                  {person.privacy_level === 'admins'
                    ? 'Chỉ quản trị viên'
                    : person.privacy_level === 'editors'
                      ? 'Biên tập viên'
                      : 'Gia đình'}
                </span>
              )}
            </h1>
            {person.other_names && (
              <p className='mt-1.5 text-sm font-medium text-stone-600 italic sm:text-sm'>
                Tên khác:{' '}
                <span className='font-medium text-stone-700 not-italic'>
                  {person.other_names}
                </span>
              </p>
            )}

            <div className='mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3'>
              {/* Birth Card */}
              <motion.div
                variants={itemVariants}
                className='rounded-2xl border border-stone-200/60 bg-white/80 p-4 backdrop-blur-sm transition-all hover:border-amber-200/60'>
                <div className='mb-2 flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <span className='size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'></span>
                    <h3 className='text-base font-semibold text-stone-400'>
                      Sinh
                    </h3>
                  </div>
                  <div className='flex items-center gap-1'>
                    {person.birth_year &&
                      getZodiacAnimal(
                        person.birth_year,
                        person.birth_month,
                        person.birth_day
                      ) && (
                        <span className='rounded-md border border-rose-200/60 bg-rose-50 px-1.5 py-0.5 font-sans text-sm font-medium whitespace-nowrap text-rose-700'>
                          Tuổi{' '}
                          {getZodiacAnimal(
                            person.birth_year,
                            person.birth_month,
                            person.birth_day
                          )}
                        </span>
                      )}
                    {person.birth_day &&
                      person.birth_month &&
                      getZodiacSign(person.birth_day, person.birth_month) && (
                        <span className='rounded-md border border-indigo-200/60 bg-indigo-50 px-1.5 py-0.5 font-sans text-sm font-medium whitespace-nowrap text-indigo-700'>
                          {getZodiacSign(person.birth_day, person.birth_month)}
                        </span>
                      )}
                  </div>
                </div>
                <div className='space-y-1.5 border-l-2 border-stone-100 pl-4'>
                  <p className='text-sm font-medium text-stone-800 sm:text-sm'>
                    {formatDisplayDate(
                      person.birth_year,
                      person.birth_month,
                      person.birth_day
                    )}
                  </p>
                  {(person.birth_year ||
                    person.birth_month ||
                    person.birth_day) && (
                    <p className='flex items-center gap-1.5 text-sm font-medium text-stone-500'>
                      <span className='rounded border border-stone-200/60 bg-stone-50/80 px-1.5 py-0.5 text-sm'>
                        Âm lịch
                      </span>
                      {getLunarDateString(
                        person.birth_year,
                        person.birth_month,
                        person.birth_day
                      ) || 'Chưa rõ'}
                    </p>
                  )}
                </div>
              </motion.div>

              {/* Death Card */}
              {isDeceased && (
                <motion.div
                  variants={itemVariants}
                  className='rounded-2xl border border-stone-200/60 bg-white/80 p-4 backdrop-blur-sm transition-all hover:border-amber-200/60'>
                  <div className='mb-2 flex items-center gap-2'>
                    <span className='size-2 rounded-full bg-stone-400 shadow-[0_0_8px_rgba(156,163,175,0.5)]'></span>
                    <h3 className='text-base font-semibold text-stone-400'>
                      Mất
                    </h3>
                  </div>
                  <div className='space-y-1.5 border-l-2 border-stone-100 pl-4'>
                    <p className='text-sm font-medium text-stone-800 sm:text-sm'>
                      {person.death_day ||
                      person.death_month ||
                      person.death_year
                        ? formatDisplayDate(
                            person.death_year,
                            person.death_month,
                            person.death_day
                          )
                        : getSolarDateString(
                            person.death_lunar_year,
                            person.death_lunar_month,
                            person.death_lunar_day
                          ) || 'Chưa rõ'}
                    </p>
                    {(person.death_year ||
                      person.death_month ||
                      person.death_day ||
                      person.death_lunar_year ||
                      person.death_lunar_month ||
                      person.death_lunar_day) && (
                      <p className='flex items-center gap-1.5 text-sm font-medium text-stone-500'>
                        <span className='rounded border border-stone-200/60 bg-stone-50/80 px-1.5 py-0.5 text-sm'>
                          Âm lịch
                        </span>
                        {person.death_lunar_day ||
                        person.death_lunar_month ||
                        person.death_lunar_year
                          ? formatDisplayDate(
                              person.death_lunar_year,
                              person.death_lunar_month,
                              person.death_lunar_day
                            )
                          : getLunarDateString(
                              person.death_year,
                              person.death_month,
                              person.death_day
                            ) || 'Chưa rõ'}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Age Card */}
              {(() => {
                const ageData = calculateAge(
                  person.birth_year,
                  person.birth_month,
                  person.birth_day,
                  person.death_year,
                  person.death_month,
                  person.death_day,
                  isDeceased
                )
                if (!ageData) return null
                return (
                  <motion.div
                    variants={itemVariants}
                    className='relative flex flex-col justify-center overflow-hidden rounded-2xl border border-amber-200/50 bg-linear-to-br from-amber-50 to-orange-50/40 p-4 transition-all'>
                    <Leaf className='absolute -right-4 -bottom-4 h-20 w-20 rotate-12 text-amber-500/10' />
                    <div className='relative z-10 mb-1.5 flex items-center gap-2'>
                      <span
                        className={`size-2 rounded-full ${ageData.isDeceased ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'}`}></span>
                      <p className='text-sm font-medium text-amber-800/60'>
                        {ageData.isDeceased
                          ? ageData.age >= 60
                            ? 'Hưởng thọ'
                            : 'Hưởng dương'
                          : 'Tuổi'}
                      </p>
                    </div>
                    <div className='relative z-10 pl-4'>
                      <p className='bg-linear-to-br from-amber-700 to-amber-900 bg-clip-text text-sm font-medium text-transparent sm:text-sm'>
                        {ageData.age}
                        <span className='ml-1.5 text-sm font-medium text-amber-700/60 sm:text-sm'>
                          tuổi
                        </span>
                      </p>
                    </div>
                  </motion.div>
                )
              })()}

              {/* Children Stats Card */}
              {relStats &&
                (relStats.biologicalChildren > 0 ||
                  relStats.sonInLaw > 0 ||
                  relStats.daughterInLaw > 0 ||
                  relStats.paternalGrandchildren > 0 ||
                  relStats.maternalGrandchildren > 0) && (
                  <motion.div
                    layout
                    variants={itemVariants}
                    className='rounded-2xl border border-stone-200/60 bg-white/80 p-4 backdrop-blur-sm transition-all hover:border-amber-200/60 sm:col-span-2 md:col-span-3'>
                    <div className='mb-3 flex items-center gap-2'>
                      <span className='size-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]'></span>
                      <h3 className='text-base font-semibold text-stone-400'>
                        Hậu duệ
                      </h3>
                    </div>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                      {/* Biological Children */}
                      {relStats.biologicalChildren > 0 && (
                        <div className='group flex flex-col justify-between rounded-xl border border-stone-100 bg-stone-50/80 p-3 transition-colors hover:bg-stone-100/80'>
                          <div className='mb-2 flex items-center gap-3'>
                            <div className='rounded-lg bg-blue-100/50 p-2 text-blue-600 transition-colors group-hover:bg-blue-100'>
                              <Users className='size-4' />
                            </div>
                            <div className='flex-1'>
                              <p className='text-sm leading-tight font-medium text-stone-500'>
                                Con ruột
                              </p>
                              <p className='mt-0.5 text-sm leading-none font-medium text-stone-700'>
                                {relStats.biologicalChildren}
                              </p>
                            </div>
                          </div>

                          <div className='mt-auto flex flex-wrap gap-1.5 border-t border-stone-200/50 pt-1'>
                            {relStats.maleBiologicalChildren > 0 && (
                              <span className='flex items-center gap-1 rounded bg-sky-100/50 px-1.5 py-0.5 text-sm font-medium text-sky-700'>
                                <MaleIcon className='size-3 shrink-0' />{' '}
                                {relStats.maleBiologicalChildren}
                              </span>
                            )}
                            {relStats.femaleBiologicalChildren > 0 && (
                              <span className='flex items-center gap-1 rounded bg-rose-100/50 px-1.5 py-0.5 text-sm font-medium text-rose-700'>
                                <FemaleIcon className='size-3 shrink-0' />{' '}
                                {relStats.femaleBiologicalChildren}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* In-Laws */}
                      {(relStats.sonInLaw > 0 ||
                        relStats.daughterInLaw > 0) && (
                        <div className='group flex flex-col rounded-xl border border-stone-100 bg-stone-50/80 p-3 transition-colors hover:bg-stone-100/80'>
                          <div className='mb-2 flex items-center gap-3'>
                            <div className='rounded-lg bg-stone-200/50 p-2 text-stone-600 transition-colors group-hover:bg-stone-200'>
                              <UserPlus className='size-4' />
                            </div>
                            <p className='text-sm font-medium text-stone-500'>
                              Dâu / Rể
                            </p>
                          </div>

                          <div className='mt-auto w-full space-y-1 border-t border-stone-200/50 pt-1'>
                            {relStats.daughterInLaw > 0 && (
                              <div className='flex items-center justify-between text-sm'>
                                <span className='font-medium text-stone-500'>
                                  Con dâu
                                </span>
                                <span className='font-medium text-stone-700'>
                                  {relStats.daughterInLaw}
                                </span>
                              </div>
                            )}
                            {relStats.sonInLaw > 0 && (
                              <div className='flex items-center justify-between text-sm'>
                                <span className='font-medium text-stone-500'>
                                  Con rể
                                </span>
                                <span className='font-medium text-stone-700'>
                                  {relStats.sonInLaw}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Grandchildren */}
                      {(relStats.paternalGrandchildren > 0 ||
                        relStats.maternalGrandchildren > 0) && (
                        <div className='group flex flex-col rounded-xl border border-stone-100 bg-stone-50/80 p-3 transition-colors hover:bg-stone-100/80'>
                          <div className='mb-2 flex items-center gap-3'>
                            <div className='rounded-lg bg-emerald-100/50 p-2 text-emerald-600 transition-colors group-hover:bg-emerald-100'>
                              <Baby className='size-4' />
                            </div>
                            <p className='text-sm font-medium text-stone-500'>
                              Cháu
                            </p>
                          </div>

                          <div className='mt-auto w-full space-y-1 border-t border-stone-200/50 pt-1'>
                            {relStats.paternalGrandchildren > 0 && (
                              <div className='flex items-center justify-between text-sm'>
                                <span className='font-medium text-stone-500'>
                                  Cháu nội
                                </span>
                                <span className='font-medium text-stone-700'>
                                  {relStats.paternalGrandchildren}
                                </span>
                              </div>
                            )}
                            {relStats.maternalGrandchildren > 0 && (
                              <div className='flex items-center justify-between text-sm'>
                                <span className='font-medium text-stone-500'>
                                  Cháu ngoại
                                </span>
                                <span className='font-medium text-stone-700'>
                                  {relStats.maternalGrandchildren}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
            </div>
          </div>
        </motion.div>

        <div className='mt-8 grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-3'>
          {/* Main Info */}
          <div className='space-y-8 lg:col-span-2'>
            <motion.div layout variants={itemVariants}>
              <SourcesManager personId={person.id} canEdit={canEdit} />
            </motion.div>

            <motion.section layout variants={itemVariants}>
              <h2 className='mb-4 flex items-center gap-2 text-base font-semibold text-stone-800 sm:text-lg'>
                <Info className='size-5 text-amber-600' />
                Ghi chú
              </h2>
              <div className='relative overflow-hidden rounded-2xl border border-stone-200/60 bg-white/80 p-5 backdrop-blur-sm sm:p-6'>
                {note ? (
                  <div className='flex flex-col'>
                    <motion.div
                      initial={false}
                      animate={{
                        height: !isNoteExpanded && isNoteLong ? '120px' : 'auto'
                      }}
                      className='relative overflow-hidden'
                      transition={{
                        type: 'spring',
                        stiffness: 100,
                        damping: 20,
                        duration: 0.4
                      }}>
                      <p className='text-sm leading-relaxed whitespace-pre-wrap text-stone-600 sm:text-sm'>
                        {note}
                      </p>
                      {/* Gradient fade overlay when collapsed */}
                      {!isNoteExpanded && isNoteLong && (
                        <div className='pointer-events-none absolute right-0 bottom-0 left-0 h-16 bg-linear-to-t from-white/95 via-white/40 to-transparent' />
                      )}
                    </motion.div>

                    {isNoteLong && (
                      <button
                        onClick={() => setIsNoteExpanded(!isNoteExpanded)}
                        className='group relative z-10 mt-4 flex w-fit items-center gap-1.5 text-sm font-medium text-amber-600 transition-colors hover:text-amber-700'>
                        <span className='underline decoration-amber-600/30 underline-offset-4 group-hover:decoration-amber-700'>
                          {isNoteExpanded ? 'Thu gọn' : 'Xem thêm'}
                        </span>
                        <motion.div
                          animate={{ rotate: isNoteExpanded ? 180 : 0 }}
                          transition={{ duration: 0.3 }}>
                          <ChevronDown className='size-3.5' />
                        </motion.div>
                      </button>
                    )}
                  </div>
                ) : (
                  <p className='text-sm text-stone-400 italic sm:text-sm'>
                    Chưa có ghi chú.
                  </p>
                )}
              </div>
            </motion.section>

            <motion.section layout variants={itemVariants}>
              <h2 className='mb-4 flex items-center gap-2 text-base font-semibold text-stone-800 sm:text-lg'>
                <Users className='size-5 text-amber-600' />
                Gia đình
              </h2>
              <div className='relative z-0 rounded-2xl border border-stone-200/60 bg-white/80 p-4 backdrop-blur-sm sm:p-6'>
                <RelationshipManager
                  person={person}
                  isAdmin={isAdmin}
                  canEdit={canEdit}
                  onStatsLoaded={handleStatsLoaded}
                />
              </div>
            </motion.section>
          </div>

          {/* Sidebar / Private Info */}
          <div className='space-y-6'>
            <motion.div layout variants={itemVariants}>
              {canEdit ? (
                <div className='rounded-2xl border border-stone-200/80 bg-stone-50 p-5 sm:p-6'>
                  <h3 className='mb-4 flex items-center gap-2 border-b border-stone-200/60 pb-3 text-base font-semibold text-stone-900 sm:text-base'>
                    <span className='rounded-lg border border-amber-200/50 bg-amber-100/80 p-1.5 text-amber-700'>
                      <Lock className='size-4' aria-hidden='true' />
                    </span>
                    Thông tin liên hệ
                  </h3>
                  <dl className='space-y-4 text-sm sm:text-sm'>
                    <div>
                      <dt className='mb-1 flex items-center gap-1.5 text-sm font-medium text-stone-500'>
                        <Phone className='h-3.5 w-3.5' /> Số điện thoại
                      </dt>
                      <dd className='rounded-lg border border-stone-200/60 bg-white px-3 py-2 font-medium text-stone-900'>
                        {(fullPerson.phone_number as string) || (
                          <span className='font-normal text-stone-400'>
                            Chưa cập nhật
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className='mb-1 flex items-center gap-1.5 text-sm font-medium text-stone-500'>
                        <Briefcase className='h-3.5 w-3.5' /> Nghề nghiệp
                      </dt>
                      <dd className='rounded-lg border border-stone-200/60 bg-white px-3 py-2 font-medium text-stone-900'>
                        {(fullPerson.occupation as string) || (
                          <span className='font-normal text-stone-400'>
                            Chưa cập nhật
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className='mb-1 flex items-center gap-1.5 text-sm font-medium text-stone-500'>
                        <MapPin className='h-3.5 w-3.5' /> Nơi ở hiện tại
                      </dt>
                      <dd className='rounded-lg border border-stone-200/60 bg-white px-3 py-2 font-medium text-stone-900'>
                        {(fullPerson.current_residence as string) || (
                          <span className='font-normal text-stone-400'>
                            Chưa cập nhật
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <div className='flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-5 text-center'>
                  <Lock className='size-4 text-stone-400' aria-hidden='true' />
                  <p className='text-sm font-medium text-stone-500'>
                    Thông tin liên hệ chỉ hiển thị với Quản trị viên.
                  </p>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
