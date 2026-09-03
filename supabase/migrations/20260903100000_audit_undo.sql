-- Safe undo RPC for recent audit log entries
alter table public.audit_log
  add column if not exists undone_audit_id bigint references public.audit_log(id) on delete set null;

create index if not exists audit_log_undone_audit_id_idx on public.audit_log(undone_audit_id);

alter table public.custom_events
  add column if not exists person_id uuid references public.persons(id) on delete set null;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  private_old_data jsonb;
  private_new_data jsonb;
  active_undone_audit_id bigint;
  undone_id_text text;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') then
    raise exception 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  end if;

  undone_id_text := current_setting('audit.undone_audit_id', true);
  if undone_id_text is not null and undone_id_text ~ '^\d+$' then
    active_undone_audit_id := undone_id_text::bigint;
  else
    active_undone_audit_id := null;
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

    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data,
      active_undone_audit_id
    );
  else
    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
      active_undone_audit_id
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.write_audit_log() from public, anon, authenticated;

create or replace function public.undo_audit_entry(audit_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry record;
  is_admin_user boolean := false;
  is_editor_user boolean := false;
  current_row_json jsonb;
  expected_row_json jsonb;
  target_person public.persons%rowtype;
  target_rel public.relationships%rowtype;
  target_evt public.custom_events%rowtype;
  target_gallery public.gallery_items%rowtype;
  affected_table text;
  affected_id uuid;
  affected_op text;
begin
  if audit_id is null or audit_id <= 0 then
    raise exception 'Invalid audit id.';
  end if;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) into is_admin_user;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'editor' and is_active = true
  ) into is_editor_user;

  if not (is_admin_user or is_editor_user) then
    raise exception 'Access denied.';
  end if;

  select *
  into entry
  from public.audit_log
  where id = audit_id
  for update;

  if not found then
    raise exception 'Audit entry not found.';
  end if;

  if entry.occurred_at < now() - interval '24 hours' then
    raise exception 'Undo window has expired.';
  end if;

  if exists (
    select 1 from public.audit_log
    where undone_audit_id = entry.id
  ) then
    raise exception 'Audit entry has already been undone.';
  end if;

  affected_table := entry.table_name;
  affected_id := entry.record_id;
  affected_op := entry.operation;

  if not (
    (affected_table = 'persons' and affected_op = 'UPDATE')
    or (affected_table = 'relationships' and affected_op in ('INSERT', 'DELETE'))
    or (affected_table = 'custom_events' and affected_op in ('INSERT', 'UPDATE', 'DELETE'))
    or (affected_table = 'gallery_items' and affected_op = 'UPDATE')
  ) then
    raise exception 'Undo is not supported for this change type.';
  end if;

  if affected_table = 'gallery_items' and not is_admin_user then
    raise exception 'Access denied.';
  end if;

  if affected_table = 'gallery_items' and exists (
    select 1
    from jsonb_object_keys(entry.new_data) as fields(field_name)
    where (entry.old_data -> field_name) is distinct from (entry.new_data -> field_name)
      and field_name not in ('title', 'description', 'event_date', 'version', 'updated_at')
  ) then
    raise exception 'Undo is not supported for gallery storage or ownership changes.';
  end if;

  perform set_config('audit.undone_audit_id', entry.id::text, true);

  if affected_table = 'persons' and affected_op = 'UPDATE' then
    select * into target_person from public.persons where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: target record no longer exists.';
    end if;

    current_row_json := to_jsonb(target_person);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: person no longer matches the audited state.';
    end if;

    update public.persons
    set
      full_name = coalesce((entry.old_data->>'full_name'), full_name),
      gender = (entry.old_data->>'gender')::public.gender_enum,
      birth_year = case when entry.old_data ? 'birth_year' then (entry.old_data->>'birth_year')::int else birth_year end,
      birth_month = case when entry.old_data ? 'birth_month' then (entry.old_data->>'birth_month')::int else birth_month end,
      birth_day = case when entry.old_data ? 'birth_day' then (entry.old_data->>'birth_day')::int else birth_day end,
      death_year = case when entry.old_data ? 'death_year' then (entry.old_data->>'death_year')::int else death_year end,
      death_month = case when entry.old_data ? 'death_month' then (entry.old_data->>'death_month')::int else death_month end,
      death_day = case when entry.old_data ? 'death_day' then (entry.old_data->>'death_day')::int else death_day end,
      death_lunar_year = case when entry.old_data ? 'death_lunar_year' then (entry.old_data->>'death_lunar_year')::int else death_lunar_year end,
      death_lunar_month = case when entry.old_data ? 'death_lunar_month' then (entry.old_data->>'death_lunar_month')::int else death_lunar_month end,
      death_lunar_day = case when entry.old_data ? 'death_lunar_day' then (entry.old_data->>'death_lunar_day')::int else death_lunar_day end,
      is_deceased = coalesce((entry.old_data->>'is_deceased')::boolean, is_deceased),
      is_in_law = coalesce((entry.old_data->>'is_in_law')::boolean, is_in_law),
      birth_order = case when entry.old_data ? 'birth_order' then (entry.old_data->>'birth_order')::int else birth_order end,
      generation = case when entry.old_data ? 'generation' then (entry.old_data->>'generation')::int else generation end,
      other_names = case when entry.old_data ? 'other_names' then entry.old_data->>'other_names' else other_names end,
      avatar_url = case when entry.old_data ? 'avatar_url' then entry.old_data->>'avatar_url' else avatar_url end,
      note = case when entry.old_data ? 'note' then entry.old_data->>'note' else note end
    where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'INSERT' then
    select * into target_rel from public.relationships where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: relationship already deleted.';
    end if;

    current_row_json := to_jsonb(target_rel);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: relationship no longer matches the audited state.';
    end if;

    delete from public.relationships where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'DELETE' then
    if exists (select 1 from public.relationships where id = affected_id) then
      raise exception 'Conflict detected: relationship with this id already exists.';
    end if;

    if not exists (select 1 from public.persons where id = (entry.old_data->>'person_a')::uuid)
       or not exists (select 1 from public.persons where id = (entry.old_data->>'person_b')::uuid) then
      raise exception 'Conflict detected: related person no longer exists.';
    end if;

    insert into public.relationships (id, type, person_a, person_b, note, created_at, updated_at)
    values (
      affected_id,
      (entry.old_data->>'type')::public.relationship_type_enum,
      (entry.old_data->>'person_a')::uuid,
      (entry.old_data->>'person_b')::uuid,
      entry.old_data->>'note',
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'custom_events' and affected_op = 'INSERT' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event already removed.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    delete from public.custom_events where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'UPDATE' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event does not exist.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    update public.custom_events
    set
      name = coalesce(entry.old_data->>'name', name),
      content = case when entry.old_data ? 'content' then entry.old_data->>'content' else content end,
      event_date = coalesce((entry.old_data->>'event_date')::date, event_date),
      location = case when entry.old_data ? 'location' then entry.old_data->>'location' else location end,
      created_by = case when entry.old_data ? 'created_by' then (entry.old_data->>'created_by')::uuid else created_by end,
      person_id = case when entry.old_data ? 'person_id' then (entry.old_data->>'person_id')::uuid else person_id end
    where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'DELETE' then
    if exists (select 1 from public.custom_events where id = affected_id) then
      raise exception 'Conflict detected: custom event already exists.';
    end if;

    insert into public.custom_events (id, name, content, event_date, location, created_by, person_id, created_at, updated_at)
    values (
      affected_id,
      entry.old_data->>'name',
      entry.old_data->>'content',
      (entry.old_data->>'event_date')::date,
      entry.old_data->>'location',
      coalesce((entry.old_data->>'created_by')::uuid, auth.uid()),
      (entry.old_data->>'person_id')::uuid,
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'gallery_items' and affected_op = 'UPDATE' then
    select * into target_gallery from public.gallery_items where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: gallery item does not exist.';
    end if;

    current_row_json := to_jsonb(target_gallery);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: gallery item no longer matches the audited state.';
    end if;

    -- Metadata update ONLY: never modify image_url or storage
    update public.gallery_items
    set
      title = coalesce(entry.old_data->>'title', title),
      description = case when entry.old_data ? 'description' then entry.old_data->>'description' else description end,
      event_date = case when entry.old_data ? 'event_date' then (entry.old_data->>'event_date')::date else event_date end
    where id = affected_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'undone_audit_id', entry.id,
    'table_name', affected_table,
    'record_id', affected_id,
    'operation', affected_op
  );
end;
$$;

revoke all on function public.undo_audit_entry(bigint) from public, anon, authenticated;
grant execute on function public.undo_audit_entry(bigint) to authenticated;
