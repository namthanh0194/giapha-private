create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  table_name text not null check (table_name in ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private')),
  record_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid,
  old_data jsonb,
  new_data jsonb
);

create index audit_log_occurred_at_id_idx on public.audit_log (occurred_at desc, id desc);
create index audit_log_record_id_idx on public.audit_log (record_id);
create index audit_log_actor_user_id_idx on public.audit_log (actor_user_id);
create index audit_log_table_name_occurred_at_idx on public.audit_log (table_name, occurred_at desc, id desc);
create index audit_log_operation_occurred_at_idx on public.audit_log (operation, occurred_at desc, id desc);
create index audit_log_actor_user_id_occurred_at_idx on public.audit_log (actor_user_id, occurred_at desc, id desc);

alter table public.audit_log enable row level security;

revoke all on table public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;

create policy "Active users can view audit summaries"
on public.audit_log
for select
to authenticated
using (
  public.is_admin()
  or (
    public.is_active_user()
    and table_name not in ('profiles', 'person_details_private')
  )
);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  private_old_data jsonb;
  private_new_data jsonb;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') then
    raise exception 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  end if;

  if tg_table_name = 'person_details_private' then
    if tg_op = 'INSERT' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    elsif tg_op = 'UPDATE' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at')
        and (to_jsonb(old) -> field_name) is distinct from (to_jsonb(new) -> field_name);
      private_old_data := jsonb_build_object('redacted', true);
    else
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_old_data
      from jsonb_object_keys(to_jsonb(old)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    end if;

    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    values (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data
    );
  else
    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    values (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.write_audit_log() from public, anon, authenticated;

create or replace function public.prevent_audit_log_truncation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Audit log cannot be truncated.';
end;
$$;

revoke all on function public.prevent_audit_log_truncation() from public, anon, authenticated;

create trigger tr_prevent_audit_log_truncate
before truncate on public.audit_log
for each statement execute function public.prevent_audit_log_truncation();

alter table public.audit_log enable always trigger tr_prevent_audit_log_truncate;

create trigger tr_audit_persons
after insert or update or delete on public.persons
for each row execute function public.write_audit_log();

create trigger tr_audit_relationships
after insert or update or delete on public.relationships
for each row execute function public.write_audit_log();

create trigger tr_audit_custom_events
after insert or update or delete on public.custom_events
for each row execute function public.write_audit_log();

create trigger tr_audit_gallery_items
after insert or update or delete on public.gallery_items
for each row execute function public.write_audit_log();

create trigger tr_audit_profiles
after insert or update or delete on public.profiles
for each row execute function public.write_audit_log();

create trigger tr_audit_person_details_private
after insert or update or delete on public.person_details_private
for each row execute function public.write_audit_log();
