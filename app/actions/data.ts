'use server'

import { Relationship, RestoreResult } from '@/types'
import { toPublicError } from '@/utils/errors'
import { withTelemetry } from '@/utils/telemetry'
import { getIsAdmin, getSupabase } from '@/utils/supabase/queries'
import { revalidatePath } from 'next/cache'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Payload shape cho file backup JSON.
 * Các field DB-managed (created_at, updated_at) được giữ để tham khảo
 * nhưng sẽ bị loại bỏ khi import lại.
 */
interface PersonExport {
  id: string
  full_name: string
  gender: 'male' | 'female' | 'other'
  birth_year: number | null
  birth_month: number | null
  birth_day: number | null
  death_year: number | null
  death_month: number | null
  death_day: number | null
  death_lunar_year: number | null
  death_lunar_month: number | null
  death_lunar_day: number | null
  is_deceased: boolean
  is_in_law: boolean
  birth_order: number | null
  generation: number | null
  other_names: string | null
  avatar_url: string | null
  note: string | null
  privacy_level?: 'family' | 'editors' | 'admins'
  // DB-managed fields (kept in export for traceability, stripped on import)
  created_at?: string
  updated_at?: string
}

interface RelationshipExport {
  id?: string
  type: string
  person_a: string
  person_b: string
  note?: string | null
  created_at?: string
  updated_at?: string
}

interface PersonDetailsPrivateExport {
  person_id: string
  phone_number: string | null
  occupation: string | null
  current_residence: string | null
}

interface CustomEventExport {
  id: string
  name: string
  content: string | null
  event_date: string
  location: string | null
  created_by: string | null
  person_id?: string | null
}

interface SourceExport {
  id: string
  title: string
  source_type: string
  author: string | null
  publisher: string | null
  publication_date: string | null
  url: string | null
  repository: string | null
  note: string | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

interface PersonCitationExport {
  id: string
  person_id: string
  source_id: string
  field_name: string | null
  page_reference: string | null
  quotation: string | null
  confidence: string
  created_by?: string | null
  created_at?: string
}

interface GalleryItemExport {
  id: string
  title: string
  description: string | null
  image_url: string
  event_date: string | null
  person_id?: string | null
  created_by?: string | null
  created_at?: string
}

interface BackupPayload {
  version: number
  timestamp: string
  persons: PersonExport[]
  relationships: RelationshipExport[]
  person_details_private?: PersonDetailsPrivateExport[]
  custom_events?: CustomEventExport[]
  sources?: SourceExport[]
  person_citations?: PersonCitationExport[]
  gallery_items?: GalleryItemExport[]
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PERSONS = 10000
const MAX_RELATIONSHIPS = 30000
const MAX_PRIVATE_DETAILS = 10000
const MAX_CUSTOM_EVENTS = 10000
const MAX_SOURCES = 10000
const MAX_PERSON_CITATIONS = 30000
const MAX_GALLERY_ITEMS = 10000

function isShortText(value: unknown, maxLength: number) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.length <= maxLength)
  )
}

function validateImportPayload(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Dữ liệu không hợp lệ.'
  const payload = input as Record<string, unknown>
  const persons = payload.persons
  const relationships = payload.relationships

  if (!Array.isArray(persons) || !Array.isArray(relationships)) {
    return 'Dữ liệu không đúng định dạng. Cần chứa danh sách persons và relationships.'
  }
  if (persons.length === 0) {
    return 'File backup trống — không có thành viên nào để phục hồi.'
  }
  if (persons.length > MAX_PERSONS)
    return 'Số lượng thành viên vượt quá giới hạn cho phép.'
  if (relationships.length > MAX_RELATIONSHIPS)
    return 'Số lượng mối quan hệ vượt quá giới hạn cho phép.'

  const personIds = new Set<string>()
  for (const person of persons) {
    if (!person || typeof person !== 'object')
      return 'Có thành viên không hợp lệ.'
    const row = person as Record<string, unknown>
    if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id))
      return 'ID thành viên không hợp lệ.'
    if (personIds.has(row.id)) return 'File chứa ID thành viên bị trùng.'
    personIds.add(row.id)
    if (
      typeof row.full_name !== 'string' ||
      row.full_name.trim().length === 0 ||
      row.full_name.length > 200
    ) {
      return 'Tên thành viên không hợp lệ.'
    }
    if (!['male', 'female', 'other'].includes(String(row.gender)))
      return 'Giới tính không hợp lệ.'
    if (
      row.privacy_level !== undefined &&
      !['family', 'editors', 'admins'].includes(String(row.privacy_level))
    ) {
      return 'Mức riêng tư không hợp lệ.'
    }
    for (const field of ['other_names', 'avatar_url', 'note']) {
      if (!isShortText(row[field], 2000)) return `Trường ${field} quá dài.`
    }
  }

  for (const relationship of relationships) {
    if (!relationship || typeof relationship !== 'object')
      return 'Có quan hệ không hợp lệ.'
    const row = relationship as Record<string, unknown>
    if (
      typeof row.person_a !== 'string' ||
      !personIds.has(row.person_a) ||
      typeof row.person_b !== 'string' ||
      !personIds.has(row.person_b) ||
      row.person_a === row.person_b ||
      !['marriage', 'biological_child', 'adopted_child'].includes(
        String(row.type)
      )
    )
      return 'Quan hệ chứa dữ liệu không hợp lệ.'
    if (!isShortText(row.note, 2000)) return 'Ghi chú quan hệ quá dài.'
  }

  const privateDetails = payload.person_details_private
  if (privateDetails !== undefined) {
    if (
      !Array.isArray(privateDetails) ||
      privateDetails.length > MAX_PRIVATE_DETAILS
    ) {
      return 'Thông tin riêng tư vượt quá giới hạn cho phép.'
    }
    for (const detail of privateDetails) {
      if (!detail || typeof detail !== 'object')
        return 'Thông tin riêng tư không hợp lệ.'
      const row = detail as Record<string, unknown>
      if (typeof row.person_id !== 'string' || !personIds.has(row.person_id))
        return 'Thông tin riêng tư trỏ tới hồ sơ không hợp lệ.'
      for (const field of ['phone_number', 'occupation', 'current_residence']) {
        if (!isShortText(row[field], 500)) return `Trường ${field} quá dài.`
      }
    }
  }

  const customEvents = payload.custom_events
  if (customEvents !== undefined) {
    if (
      !Array.isArray(customEvents) ||
      customEvents.length > MAX_CUSTOM_EVENTS
    ) {
      return 'Số lượng sự kiện vượt quá giới hạn cho phép.'
    }
    for (const event of customEvents) {
      if (!event || typeof event !== 'object') return 'Sự kiện không hợp lệ.'
      const row = event as Record<string, unknown>
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id))
        return 'ID sự kiện không hợp lệ.'
      if (
        typeof row.name !== 'string' ||
        row.name.trim().length === 0 ||
        row.name.length > 200
      )
        return 'Tên sự kiện không hợp lệ.'
      for (const field of ['content', 'location']) {
        if (!isShortText(row[field], 2000)) return `Trường ${field} quá dài.`
      }
    }
  }

  const sources = payload.sources
  if (sources !== undefined) {
    if (!Array.isArray(sources) || sources.length > MAX_SOURCES) {
      return 'Số lượng nguồn tư liệu vượt quá giới hạn cho phép.'
    }
    const sourceIds = new Set<string>()
    for (const source of sources) {
      if (!source || typeof source !== 'object')
        return 'Nguồn tư liệu không hợp lệ.'
      const row = source as Record<string, unknown>
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id))
        return 'ID nguồn tư liệu không hợp lệ.'
      if (sourceIds.has(row.id)) return 'File chứa ID nguồn tư liệu bị trùng.'
      sourceIds.add(row.id)
      if (
        typeof row.title !== 'string' ||
        row.title.trim().length === 0 ||
        row.title.length > 200 ||
        ![
          'document',
          'book',
          'oral_history',
          'website',
          'photo',
          'other'
        ].includes(String(row.source_type))
      ) {
        return 'Nguồn tư liệu không hợp lệ.'
      }
      if (
        !isShortText(row.author, 300) ||
        !isShortText(row.publisher, 300) ||
        !isShortText(row.repository, 500) ||
        !isShortText(row.note, 5000)
      ) {
        return 'Nguồn tư liệu có trường quá dài.'
      }
      if (
        !isShortText(row.url, 2048) ||
        (typeof row.url === 'string' && !/^https?:\/\/\S+$/i.test(row.url))
      ) {
        return 'URL nguồn tư liệu không hợp lệ.'
      }
    }

    const citations = payload.person_citations
    if (citations !== undefined) {
      if (
        !Array.isArray(citations) ||
        citations.length > MAX_PERSON_CITATIONS
      ) {
        return 'Số lượng trích dẫn vượt quá giới hạn cho phép.'
      }
      const citationIds = new Set<string>()
      for (const citation of citations) {
        if (!citation || typeof citation !== 'object')
          return 'Trích dẫn không hợp lệ.'
        const row = citation as Record<string, unknown>
        if (
          typeof row.id !== 'string' ||
          !UUID_PATTERN.test(row.id) ||
          citationIds.has(row.id)
        ) {
          return 'ID trích dẫn không hợp lệ.'
        }
        citationIds.add(row.id)
        if (
          typeof row.person_id !== 'string' ||
          !personIds.has(row.person_id) ||
          typeof row.source_id !== 'string' ||
          !sourceIds.has(row.source_id)
        ) {
          return 'Trích dẫn trỏ tới thực thể không hợp lệ.'
        }
        if (
          row.field_name !== null &&
          row.field_name !== undefined &&
          ![
            'birth_date',
            'death_date',
            'relationship',
            'note',
            'other'
          ].includes(String(row.field_name))
        ) {
          return 'Trường thông tin trích dẫn không hợp lệ.'
        }
        if (
          !isShortText(row.page_reference, 300) ||
          !isShortText(row.quotation, 5000)
        ) {
          return 'Trích dẫn có trường quá dài.'
        }
        if (
          !['primary', 'secondary', 'uncertain'].includes(
            String(row.confidence)
          )
        ) {
          return 'Độ tin cậy trích dẫn không hợp lệ.'
        }
      }
    }
  }

  const galleryItems = payload.gallery_items
  if (galleryItems !== undefined) {
    if (
      !Array.isArray(galleryItems) ||
      galleryItems.length > MAX_GALLERY_ITEMS
    ) {
      return 'Số lượng hình ảnh thư viện vượt quá giới hạn cho phép.'
    }
    const galleryIds = new Set<string>()
    for (const item of galleryItems) {
      if (!item || typeof item !== 'object')
        return 'Hình ảnh thư viện không hợp lệ.'
      const row = item as Record<string, unknown>
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id))
        return 'ID hình ảnh không hợp lệ.'
      if (galleryIds.has(row.id)) return 'File chứa ID hình ảnh bị trùng.'
      galleryIds.add(row.id)
      if (
        typeof row.title !== 'string' ||
        row.title.trim().length === 0 ||
        row.title.length > 200
      ) {
        return 'Tiêu đề hình ảnh không hợp lệ.'
      }
      if (!isShortText(row.description, 2000)) return 'Mô tả hình ảnh quá dài.'
      if (
        typeof row.image_url !== 'string' ||
        row.image_url.trim().length === 0 ||
        row.image_url.length > 2048
      ) {
        return 'Đường dẫn hình ảnh không hợp lệ.'
      }
      if (
        row.event_date !== null &&
        row.event_date !== undefined &&
        (typeof row.event_date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.event_date))
      ) {
        return 'Ngày sự kiện của hình ảnh không hợp lệ.'
      }
      if (
        row.person_id !== null &&
        row.person_id !== undefined &&
        (typeof row.person_id !== 'string' || !personIds.has(row.person_id))
      ) {
        return 'ID thành viên liên kết với hình ảnh không hợp lệ.'
      }
    }
  }

  return null
}

function sanitizePerson(p: PersonExport) {
  return {
    id: p.id,
    full_name: p.full_name.trim(),
    gender: p.gender,
    birth_year: p.birth_year ?? null,
    birth_month: p.birth_month ?? null,
    birth_day: p.birth_day ?? null,
    death_year: p.death_year ?? null,
    death_month: p.death_month ?? null,
    death_day: p.death_day ?? null,
    death_lunar_year: p.death_lunar_year ?? null,
    death_lunar_month: p.death_lunar_month ?? null,
    death_lunar_day: p.death_lunar_day ?? null,
    is_deceased: Boolean(p.is_deceased),
    is_in_law: Boolean(p.is_in_law),
    birth_order: p.birth_order ?? null,
    generation: p.generation ?? null,
    other_names: p.other_names?.trim() || null,
    avatar_url: p.avatar_url ?? null,
    note: p.note?.trim() || null,
    privacy_level: p.privacy_level ?? 'family'
  }
}

function sanitizeRelationship(r: RelationshipExport | Relationship) {
  return {
    type: r.type,
    person_a: r.person_a,
    person_b: r.person_b,
    note: r.note?.trim() || null
  }
}

function sanitizeCustomEvent(event: CustomEventExport) {
  return {
    id: event.id,
    name: event.name.trim(),
    content: event.content?.trim() || null,
    event_date: event.event_date,
    location: event.location?.trim() || null,
    person_id: event.person_id || null
  }
}

function sanitizeSource(raw: SourceExport) {
  return {
    id: raw.id,
    title: raw.title.trim(),
    source_type: raw.source_type,
    author: raw.author?.trim() || null,
    publisher: raw.publisher?.trim() || null,
    publication_date: raw.publication_date || null,
    url: raw.url?.trim() || null,
    repository: raw.repository?.trim() || null,
    note: raw.note?.trim() || null
  }
}

function sanitizePersonCitation(raw: PersonCitationExport) {
  return {
    id: raw.id,
    person_id: raw.person_id,
    source_id: raw.source_id,
    field_name: raw.field_name || null,
    page_reference: raw.page_reference?.trim() || null,
    quotation: raw.quotation?.trim() || null,
    confidence: raw.confidence
  }
}

function sanitizeGalleryItem(raw: GalleryItemExport) {
  return {
    id: raw.id,
    title: raw.title.trim(),
    description: raw.description?.trim() || null,
    image_url: raw.image_url.trim(),
    event_date: raw.event_date || null,
    person_id: raw.person_id || null
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportData(
  exportRootId?: string
): Promise<BackupPayload | { error: string; errorId?: string }> {
  const isAdmin = await getIsAdmin()
  if (!isAdmin) {
    return { error: 'Từ chối truy cập. Chỉ admin mới có quyền này.' }
  }

  const supabase = await getSupabase()

  const [
    { data: rawPersons, error: personsError },
    { data: rawRels, error: relsError },
    { data: rawPrivateDetails, error: privError },
    { data: rawCustomEvents, error: eventsError },
    { data: rawSources, error: sourcesError },
    { data: rawCitations, error: citationsError },
    { data: rawGalleryItems, error: galleryError }
  ] = await Promise.all([
    supabase
      .from('persons')
      .select(
        'id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level, created_at, updated_at'
      )
      .order('id'),
    supabase
      .from('relationships')
      .select('id, type, person_a, person_b, note, created_at, updated_at')
      .order('id'),
    supabase
      .from('person_details_private')
      .select('person_id, phone_number, occupation, current_residence')
      .order('person_id'),
    supabase
      .from('custom_events')
      .select('id, name, content, event_date, location, created_by, person_id')
      .order('event_date', { ascending: true }),
    supabase
      .from('sources')
      .select(
        'id, title, source_type, author, publisher, publication_date, url, repository, note, created_by, created_at, updated_at'
      )
      .order('id'),
    supabase
      .from('person_citations')
      .select(
        'id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by, created_at'
      )
      .order('id'),
    supabase
      .from('gallery_items')
      .select(
        'id, title, description, image_url, event_date, person_id, created_by, created_at'
      )
      .order('id')
  ])

  if (
    personsError ||
    relsError ||
    privError ||
    eventsError ||
    sourcesError ||
    citationsError ||
    galleryError
  ) {
    const publicError = toPublicError(
      personsError ||
        relsError ||
        privError ||
        eventsError ||
        sourcesError ||
        citationsError ||
        galleryError,
      'Không thể trích xuất dữ liệu.',
      {
        event: 'backup.export.failed'
      }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  const allPersons = (rawPersons ?? []) as PersonExport[]
  const allRels = (rawRels ?? []) as RelationshipExport[]
  const allPrivateDetails = (rawPrivateDetails ??
    []) as PersonDetailsPrivateExport[]
  const allCustomEvents = (rawCustomEvents ?? []) as CustomEventExport[]
  const allSources = (rawSources ?? []) as SourceExport[]
  const allPersonCitations = (rawCitations ?? []) as PersonCitationExport[]
  const allGalleryItems = (rawGalleryItems ?? []) as GalleryItemExport[]

  let exportPersons = allPersons
  let exportRels = allRels
  let exportPrivateDetails = allPrivateDetails
  let exportPersonCitations = allPersonCitations
  let exportGalleryItems = allGalleryItems
  const exportCustomEvents = allCustomEvents
  const exportSources = allSources

  // If a root person is selected, filter the export to only their subtree
  if (exportRootId && exportPersons.some((p) => p.id === exportRootId)) {
    const includedPersonIds = new Set<string>([exportRootId])
    const childrenMap = new Map<string, string[]>()
    const spouseMap = new Map<string, string[]>()

    exportRels.forEach((r) => {
      if (r.type === 'biological_child' || r.type === 'adopted_child') {
        if (!childrenMap.has(r.person_a)) childrenMap.set(r.person_a, [])
        childrenMap.get(r.person_a)!.push(r.person_b)
      } else if (r.type === 'marriage') {
        if (!spouseMap.has(r.person_a)) spouseMap.set(r.person_a, [])
        if (!spouseMap.has(r.person_b)) spouseMap.set(r.person_b, [])
        spouseMap.get(r.person_a)!.push(r.person_b)
        spouseMap.get(r.person_b)!.push(r.person_a)
      }
    })

    // 1. Traverse biological and adopted children recursively
    const findDescendants = (parentId: string) => {
      const children = childrenMap.get(parentId) || []
      children.forEach((childId) => {
        if (!includedPersonIds.has(childId)) {
          includedPersonIds.add(childId)
          findDescendants(childId)
        }
      })
    }
    findDescendants(exportRootId)

    // 2. Add spouses for everyone in the tree so far
    const descendantsArray = Array.from(includedPersonIds) // snapshot current members
    descendantsArray.forEach((personId) => {
      const spouses = spouseMap.get(personId) || []
      spouses.forEach((spouseId) => {
        includedPersonIds.add(spouseId)
      })
    })

    // 3. Filter the payload
    exportPersons = exportPersons.filter((p) => includedPersonIds.has(p.id))
    exportRels = exportRels.filter(
      (r) =>
        includedPersonIds.has(r.person_a) && includedPersonIds.has(r.person_b)
    )
    exportPrivateDetails = exportPrivateDetails.filter((d) =>
      includedPersonIds.has(d.person_id)
    )
    exportPersonCitations = exportPersonCitations.filter((citation) =>
      includedPersonIds.has(citation.person_id)
    )
    exportGalleryItems = exportGalleryItems.filter(
      (item) => !item.person_id || includedPersonIds.has(item.person_id)
    )
    // custom_events are not person-scoped, so export all when subtree is selected
  }

  return {
    version: 5,
    timestamp: new Date().toISOString(),
    persons: exportPersons,
    relationships: exportRels,
    person_details_private: exportPrivateDetails,
    custom_events: exportCustomEvents,
    sources: exportSources,
    person_citations: exportPersonCitations,
    gallery_items: exportGalleryItems
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

export async function importData(
  importPayload:
    | BackupPayload
    | {
        persons: PersonExport[]
        relationships: Relationship[]
        person_details_private?: PersonDetailsPrivateExport[]
        custom_events?: CustomEventExport[]
        sources?: SourceExport[]
        person_citations?: PersonCitationExport[]
        gallery_items?: GalleryItemExport[]
      }
) {
  return await withTelemetry('restore.backup', { route: '/actions/data', roleClass: 'admin' }, async (scope) => {
  const isAdmin = await getIsAdmin()
  if (!isAdmin) {
    return { error: 'Từ chối truy cập. Chỉ admin mới có quyền này.' }
  }

  const supabase = await getSupabase()

  const validationError = validateImportPayload(importPayload)
  if (validationError) return { error: validationError }

  const { data, error } = await supabase.rpc('restore_backup', {
    import_payload: {
      version: 5,
      timestamp: new Date().toISOString(),
      persons: importPayload.persons.map(sanitizePerson),
      relationships: importPayload.relationships.map(sanitizeRelationship),
      person_details_private: importPayload.person_details_private ?? [],
      custom_events: (importPayload.custom_events ?? []).map(
        sanitizeCustomEvent
      ),
      sources: (importPayload.sources ?? []).map(sanitizeSource),
      person_citations: (importPayload.person_citations ?? []).map(
        sanitizePersonCitation
      ),
      gallery_items: (importPayload.gallery_items ?? []).map(
        sanitizeGalleryItem
      )
    }
  })

  if (error) {
    const publicError = toPublicError(
      error,
      'Không thể phục hồi dữ liệu. Dữ liệu hiện tại vẫn được giữ nguyên.',
      {
        event: 'backup.restore.failed',
        fields: {
          personsCount: importPayload.persons.length,
          relationshipsCount: importPayload.relationships.length,
          customEventsCount: importPayload.custom_events?.length ?? 0,
          sourcesCount: importPayload.sources?.length ?? 0,
          citationsCount: importPayload.person_citations?.length ?? 0,
          galleryItemsCount: importPayload.gallery_items?.length ?? 0
        }
      }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  const imported = data as RestoreResult & {
    sources: number
    person_citations: number
    gallery_items: number
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/members')
  revalidatePath('/dashboard/data')

  scope.add({ rowCount: imported.persons + imported.relationships })

  return {
    success: true,
    imported
  }
  })
}
