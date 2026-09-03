import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function getTestAdminSupabase() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for local E2E tests.')
  }

  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

export async function ensureTestUser({
  email,
  password,
  role,
  isActive
}: {
  email: string
  password: string
  role: 'admin' | 'editor' | 'member'
  isActive: boolean
}) {
  const supabase = getTestAdminSupabase()
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) {
    throw new Error(`Failed to list local test users: ${listError.message}`)
  }
  if (listData.users.some((user) => user.email === email)) {
    throw new Error(`Refusing to modify an existing user: ${email}`)
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })
  if (error || !data.user) {
    throw new Error(`Failed to create test user ${email}: ${error?.message}`)
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: data.user.id, role, is_active: isActive })
  if (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id)
    throw new Error(`Failed to configure test user ${email}: ${profileError.message}`)
  }

  return { id: data.user.id, email, password }
}
export async function ensureBucket(bucketName: string) {
  const supabase = getTestAdminSupabase()
  const { data: buckets } = await supabase.storage.listBuckets()
  const exists = buckets?.some((b) => b.name === bucketName)
  if (!exists) {
    await supabase.storage.createBucket(bucketName, { public: false })
  }
}

export async function seedPaginationPersons(runId: string, count: number = 60): Promise<string[]> {
  const supabase = getTestAdminSupabase()
  const baseYear = 1900
  const rows = Array.from({ length: count }, (_, index) => {
    const num = index + 1
    return {
      full_name: `E2E ${runId} Person ${String(num).padStart(4, '0')}`,
      gender: num % 2 === 0 ? 'female' : 'male',
      birth_year: baseYear + (index % 100),
      generation: (index % 5) + 1,
      birth_order: (index % 4) + 1,
      is_deceased: index % 7 === 0,
      is_in_law: index % 6 === 0
    }
  })

  const { data, error } = await supabase.from('persons').insert(rows).select('id')
  if (error || !data) {
    throw new Error(`Failed to seed pagination persons: ${error?.message}`)
  }

  return data.map((row) => row.id)
}