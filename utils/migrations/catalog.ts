import { promises as fs } from 'node:fs'
import path from 'node:path'

export const MIGRATION_CATALOG = [
  'supabase/migrations/20260831000000_init_giapha_schema.sql',
  'supabase/migrations/20260831154338_harden_function_execute_permissions.sql',
  'supabase/migrations/20260901090000_transactional_restore.sql',
  'supabase/migrations/20260901100000_align_custom_event_permissions.sql',
  'supabase/migrations/20260901110000_relationship_integrity.sql',
  'supabase/migrations/20260901120000_atomic_relationship_workflows.sql',
  'supabase/migrations/20260901130000_data_value_constraints.sql',
  'supabase/migrations/20260902090000_remove_auth_internal_admin_functions.sql',
  'supabase/migrations/20260902100000_admin_deletion_reservations.sql',
  'supabase/migrations/20260902110000_safe_restore_unconstrained_deletes.sql',
  'supabase/migrations/20260902120000_public_readiness_rpc.sql',
  'supabase/migrations/20260903090000_audit_log.sql',
  'supabase/migrations/20260903100000_audit_undo.sql',
  'supabase/migrations/20260903110000_sources_and_citations.sql',
  'supabase/migrations/20260903120000_merge_person_records.sql',
  'supabase/migrations/20260903130000_person_privacy.sql',
  'supabase/migrations/20260903140000_change_requests.sql'
  ,'supabase/migrations/20260904090000_family_graph_queries.sql'
  ,'supabase/migrations/20260904100000_person_search.sql',
  'supabase/migrations/20260904110000_optimistic_concurrency.sql'
] as const

export async function readMigrationContent(
  file: (typeof MIGRATION_CATALOG)[number]
) {
  switch (file) {
    case 'supabase/migrations/20260831000000_init_giapha_schema.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260831000000_init_giapha_schema.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260831154338_harden_function_execute_permissions.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260831154338_harden_function_execute_permissions.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260901090000_transactional_restore.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260901090000_transactional_restore.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260901100000_align_custom_event_permissions.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260901100000_align_custom_event_permissions.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260901110000_relationship_integrity.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260901110000_relationship_integrity.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260901120000_atomic_relationship_workflows.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260901120000_atomic_relationship_workflows.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260901130000_data_value_constraints.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260901130000_data_value_constraints.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260902090000_remove_auth_internal_admin_functions.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260902090000_remove_auth_internal_admin_functions.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260902100000_admin_deletion_reservations.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260902100000_admin_deletion_reservations.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260902110000_safe_restore_unconstrained_deletes.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260902110000_safe_restore_unconstrained_deletes.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260902120000_public_readiness_rpc.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260902120000_public_readiness_rpc.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260903090000_audit_log.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260903090000_audit_log.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260903100000_audit_undo.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260903100000_audit_undo.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260903110000_sources_and_citations.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260903110000_sources_and_citations.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260903120000_merge_person_records.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260903120000_merge_person_records.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260903130000_person_privacy.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260903130000_person_privacy.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260903140000_change_requests.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260903140000_change_requests.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260904090000_family_graph_queries.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260904090000_family_graph_queries.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260904100000_person_search.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260904100000_person_search.sql'
        ),
        'utf8'
      )
    case 'supabase/migrations/20260904110000_optimistic_concurrency.sql':
      return fs.readFile(
        path.join(
          process.cwd(),
          'supabase/migrations/20260904110000_optimistic_concurrency.sql'
        ),
        'utf8'
      )
  }
}
