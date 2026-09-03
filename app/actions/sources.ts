'use server'

import {
  CitationConfidence,
  CitationFieldName,
  SourceType
} from '@/types'
import { toPublicError } from '@/utils/errors'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SOURCE_TYPES: SourceType[] = [
  'document',
  'book',
  'oral_history',
  'website',
  'photo',
  'other'
]
const CITATION_FIELDS: CitationFieldName[] = [
  'birth_date',
  'death_date',
  'relationship',
  'note',
  'other'
]
const CONFIDENCE_VALUES: CitationConfidence[] = [
  'primary',
  'secondary',
  'uncertain'
]

interface SaveSourceCitationInput {
  sourceId?: string
  citationId?: string
  expectedSourceVersion?: number
  expectedCitationVersion?: number
  source: {
    title: string
    source_type: SourceType
    author: string | null
    publisher: string | null
    publication_date: string | null
    url: string | null
    repository: string | null
    note: string | null
  }
  citation: {
    person_id: string
    field_name: CitationFieldName | null
    page_reference: string | null
    quotation: string | null
    confidence: CitationConfidence
  }
}

function validOptionalText(value: string | null, maxLength: number) {
  return value === null || value.length <= maxLength
}

export async function saveSourceCitation(input: SaveSourceCitationInput) {
  const { source, citation, sourceId, citationId } = input
  if (
    !source ||
    !citation ||
    !UUID_PATTERN.test(citation.person_id) ||
    Boolean(sourceId) !== Boolean(citationId) ||
    (Boolean(sourceId) && (!Number.isSafeInteger(input.expectedSourceVersion) || (input.expectedSourceVersion ?? 0) < 1 || !Number.isSafeInteger(input.expectedCitationVersion) || (input.expectedCitationVersion ?? 0) < 1)) ||
    (sourceId !== undefined && !UUID_PATTERN.test(sourceId)) ||
    (citationId !== undefined && !UUID_PATTERN.test(citationId)) ||
    source.title.trim().length === 0 ||
    source.title.length > 200 ||
    !SOURCE_TYPES.includes(source.source_type) ||
    !validOptionalText(source.author, 300) ||
    !validOptionalText(source.publisher, 300) ||
    !validOptionalText(source.url, 2048) ||
    !validOptionalText(source.repository, 500) ||
    !validOptionalText(source.note, 5000) ||
    (source.publication_date !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(source.publication_date)) ||
    (source.url !== null && !/^https?:\/\/\S+$/i.test(source.url)) ||
    (citation.field_name !== null &&
      !CITATION_FIELDS.includes(citation.field_name)) ||
    !validOptionalText(citation.page_reference, 300) ||
    !validOptionalText(citation.quotation, 5000) ||
    !CONFIDENCE_VALUES.includes(citation.confidence)
  ) {
    return { error: 'Dữ liệu nguồn tư liệu không hợp lệ.' }
  }

  const profile = await getProfile()
  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return {
      error: 'Từ chối truy cập. Chỉ Admin hoặc Editor mới có quyền chỉnh sửa.'
    }
  }

  const supabase = await getSupabase()
  const isEdit = Boolean(sourceId) && Boolean(citationId)
  const { data, error } = await supabase.rpc('save_source_and_citation', {
    source_payload: { ...source, title: source.title.trim() },
    citation_payload: citation,
    existing_source_id: sourceId ?? null,
    existing_citation_id: citationId ?? null,
    expected_source_version: isEdit ? input.expectedSourceVersion : null,
    expected_citation_version: isEdit ? input.expectedCitationVersion : null
  })

  if (error?.code === '40001') {
    return {
      error: 'Dữ liệu đã được người khác cập nhật.',
      conflict: true
    }
  }

  if (error) {
    const publicError = toPublicError(
      error,
      'Không thể lưu nguồn tư liệu. Vui lòng kiểm tra lại và thử lại.',
      {
        event: 'source.citation.save_failed',
        fields: {
          personId: citation.person_id,
          sourceId: sourceId ?? null,
          citationId: citationId ?? null
        }
      }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  return { success: true, data }
}
