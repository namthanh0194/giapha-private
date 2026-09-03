export type Gender = 'male' | 'female' | 'other'
export type RelationshipType = 'marriage' | 'biological_child' | 'adopted_child'
export type UserRole = 'admin' | 'editor' | 'member'
export type PrivacyLevel = 'family' | 'editors' | 'admins'

export interface Profile {
  id: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AdminUserData {
  id: string
  email: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface RestoreResult {
  persons: number
  relationships: number
  person_details_private: number
  custom_events: number
  gallery_items?: number
}

export interface Person {
  version?: number
  id: string
  full_name: string
  gender: Gender
  birth_year: number | null
  birth_month: number | null
  birth_day: number | null
  death_year: number | null
  death_month: number | null
  death_day: number | null
  avatar_url: string | null
  note: string | null
  created_at: string
  updated_at: string

  // Private fields (optional, as they might not be returned for members)
  phone_number?: string | null
  occupation?: string | null
  current_residence?: string | null

  // Lunar Date
  death_lunar_year: number | null
  death_lunar_month: number | null
  death_lunar_day: number | null

  // New fields
  is_deceased: boolean
  is_in_law: boolean
  birth_order: number | null
  generation: number | null
  other_names: string | null
  privacy_level?: PrivacyLevel
  is_private_placeholder?: boolean
}

export interface Relationship {
  id: string
  type: RelationshipType
  person_a: string // UUID
  person_b: string // UUID
  note?: string | null
  created_at: string
  updated_at: string
  version?: number
}

// Helper types for UI
export interface PersonWithDetails extends Person {
  spouses?: Person[]
  children?: Person[]
  parents?: Person[]
}

export interface GalleryItem {
  version?: number
  id: string
  title: string
  description: string | null
  image_url: string
  event_date: string | null // ISO string or date string
  created_at: string
  created_by: string | null
  // Storage path used to create signed URLs and delete the object.
  storage_path?: string
}

export type SourceType =
  'document' | 'book' | 'oral_history' | 'website' | 'photo' | 'other'

export type CitationFieldName =
  'birth_date' | 'death_date' | 'relationship' | 'note' | 'other'

export type CitationConfidence = 'primary' | 'secondary' | 'uncertain'

export interface Source {
  version?: number
  id: string
  title: string
  source_type: SourceType
  author: string | null
  publisher: string | null
  publication_date: string | null
  url: string | null
  repository: string | null
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PersonCitation {
  version?: number
  id: string
  person_id: string
  source_id: string
  field_name: CitationFieldName | null
  page_reference: string | null
  quotation: string | null
  confidence: CitationConfidence
  created_by: string | null
  created_at: string
  source: Source
}

export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE'
export type AuditTableName =
  | 'persons'
  | 'relationships'
  | 'custom_events'
  | 'gallery_items'
  | 'profiles'
  | 'person_details_private'

export interface AuditLogEntry {
  id: number
  occurred_at: string
  table_name: AuditTableName
  record_id: string
  operation: AuditOperation
  actor_user_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}
