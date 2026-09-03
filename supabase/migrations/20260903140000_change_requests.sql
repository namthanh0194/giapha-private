create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  target_table text not null,
  target_id uuid not null,
  operation text not null,
  proposed_data jsonb not null,
  status text not null default 'pending',
  requester_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewer_id uuid references public.profiles(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  withdrawn_at timestamptz,
  target_updated_at timestamptz,
  constraint change_requests_target_table_chk check (target_table in ('persons', 'custom_events', 'sources', 'person_citations')),
  constraint change_requests_operation_chk check (operation in ('INSERT', 'UPDATE')),
  constraint change_requests_status_chk check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint change_requests_proposed_data_chk check (jsonb_typeof(proposed_data) = 'object' and proposed_data <> '{}'::jsonb),
  constraint change_requests_review_note_length_chk check (review_note is null or char_length(review_note) <= 5000),
  constraint change_requests_state_chk check (
    (status = 'pending' and reviewer_id is null and reviewed_at is null and withdrawn_at is null)
    or (status in ('approved', 'rejected') and reviewer_id is not null and reviewed_at is not null and withdrawn_at is null)
    or (status = 'withdrawn' and reviewer_id is null and reviewed_at is null and withdrawn_at is not null)
  ),
  constraint change_requests_rejection_note_chk check (status <> 'rejected' or nullif(btrim(review_note), '') is not null)
);

create index change_requests_requester_created_idx on public.change_requests (requester_id, created_at desc);
create index change_requests_review_queue_idx on public.change_requests (status, created_at) where status = 'pending';

create trigger tr_change_requests_updated_at
before update on public.change_requests
for each row execute procedure public.handle_updated_at();

alter table public.change_requests enable row level security;
revoke all on table public.change_requests from public, anon;
grant select on table public.change_requests to authenticated;

create or replace function public.change_request_target_person(
  requested_target_table text,
  requested_target_id uuid,
  requested_data jsonb
)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if requested_target_table = 'persons' then
    return requested_target_id;
  end if;

  if requested_target_table in ('custom_events', 'person_citations') then
    return nullif(requested_data ->> 'person_id', '')::uuid;
  end if;

  return null;
exception
  when invalid_text_representation then
    return '00000000-0000-0000-0000-000000000000'::uuid;
end;
$$;

revoke all on function public.change_request_target_person(text, uuid, jsonb) from public, anon;
grant execute on function public.change_request_target_person(text, uuid, jsonb) to authenticated;

create policy "Requesters can read own change requests"
on public.change_requests for select to authenticated
using (
  public.is_active_user()
  and requester_id = auth.uid()
  and (
    public.change_request_target_person(target_table, target_id, proposed_data) is null
    or public.can_view_person(public.change_request_target_person(target_table, target_id, proposed_data))
  )
);

create policy "Admins and editors can review visible change requests"
on public.change_requests for select to authenticated
using (
  (public.is_admin() or public.is_editor())
  and (
    public.change_request_target_person(target_table, target_id, proposed_data) is null
    or public.can_view_person(public.change_request_target_person(target_table, target_id, proposed_data))
  )
);

create or replace function public.validate_change_request_payload(
  requested_target_table text,
  requested_target_id uuid,
  requested_operation text,
  requested_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  unsupported_fields text[];
begin
  if jsonb_typeof(requested_data) <> 'object' or requested_data = '{}'::jsonb then
    raise exception 'Proposed data must be a non-empty JSON object.';
  end if;

  if requested_target_table = 'persons' then
    if requested_operation <> 'UPDATE' then
      raise exception 'Persons only support UPDATE change requests.';
    end if;
    if not exists (select 1 from public.persons where id = requested_target_id) then
      raise exception 'Target person does not exist.';
    end if;
    select array_agg(key) into unsupported_fields
    from jsonb_object_keys(requested_data) as fields(key)
    where key not in (
      'full_name', 'gender', 'birth_year', 'birth_month', 'birth_day',
      'death_year', 'death_month', 'death_day', 'death_lunar_year',
      'death_lunar_month', 'death_lunar_day', 'is_deceased', 'other_names', 'note'
    );
    if unsupported_fields is not null then
      raise exception 'Unsupported person fields: %', array_to_string(unsupported_fields, ', ');
    end if;
    if requested_data ? 'full_name' and (jsonb_typeof(requested_data -> 'full_name') <> 'string' or char_length(btrim(requested_data ->> 'full_name')) = 0) then
      raise exception 'Person full_name must be a non-empty string.';
    end if;
    if requested_data ? 'gender' and coalesce(requested_data ->> 'gender', '') not in ('male', 'female', 'other') then
      raise exception 'Person gender is invalid.';
    end if;
    perform (requested_data ->> 'birth_year')::integer where requested_data ? 'birth_year' and requested_data -> 'birth_year' <> 'null'::jsonb;
    perform (requested_data ->> 'birth_month')::integer where requested_data ? 'birth_month' and requested_data -> 'birth_month' <> 'null'::jsonb;
    perform (requested_data ->> 'birth_day')::integer where requested_data ? 'birth_day' and requested_data -> 'birth_day' <> 'null'::jsonb;
    perform (requested_data ->> 'death_year')::integer where requested_data ? 'death_year' and requested_data -> 'death_year' <> 'null'::jsonb;
    perform (requested_data ->> 'death_month')::integer where requested_data ? 'death_month' and requested_data -> 'death_month' <> 'null'::jsonb;
    perform (requested_data ->> 'death_day')::integer where requested_data ? 'death_day' and requested_data -> 'death_day' <> 'null'::jsonb;
    perform (requested_data ->> 'death_lunar_year')::integer where requested_data ? 'death_lunar_year' and requested_data -> 'death_lunar_year' <> 'null'::jsonb;
    perform (requested_data ->> 'death_lunar_month')::integer where requested_data ? 'death_lunar_month' and requested_data -> 'death_lunar_month' <> 'null'::jsonb;
    perform (requested_data ->> 'death_lunar_day')::integer where requested_data ? 'death_lunar_day' and requested_data -> 'death_lunar_day' <> 'null'::jsonb;
    perform (requested_data ->> 'is_deceased')::boolean where requested_data ? 'is_deceased' and requested_data -> 'is_deceased' <> 'null'::jsonb;
    return;
  end if;

  if requested_operation <> 'INSERT' then
    raise exception '% only supports INSERT change requests.', requested_target_table;
  end if;
  if coalesce(requested_data ->> 'id', '') <> requested_target_id::text then
    raise exception 'Proposed id must match target_id.';
  end if;

  if requested_target_table = 'custom_events' then
    select array_agg(key) into unsupported_fields
    from jsonb_object_keys(requested_data) as fields(key)
    where key not in ('id', 'name', 'content', 'event_date', 'location', 'person_id');
    if unsupported_fields is not null then
      raise exception 'Unsupported custom event fields: %', array_to_string(unsupported_fields, ', ');
    end if;
    if char_length(btrim(coalesce(requested_data ->> 'name', ''))) = 0 then
      raise exception 'Custom event name is required.';
    end if;
    if requested_data ->> 'event_date' is null or (requested_data ->> 'event_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Custom event event_date must be in YYYY-MM-DD format.';
    end if;
    if requested_data ? 'person_id' and requested_data -> 'person_id' <> 'null'::jsonb then
      if not exists (select 1 from public.persons where id = (requested_data ->> 'person_id')::uuid) then
        raise exception 'Referenced person does not exist.';
      end if;
    end if;
    return;
  end if;

  if requested_target_table = 'sources' then
    select array_agg(key) into unsupported_fields
    from jsonb_object_keys(requested_data) as fields(key)
    where key not in ('id', 'title', 'source_type', 'author', 'publisher', 'publication_date', 'url', 'repository', 'note');
    if unsupported_fields is not null then
      raise exception 'Unsupported source fields: %', array_to_string(unsupported_fields, ', ');
    end if;
    if char_length(btrim(coalesce(requested_data ->> 'title', ''))) not between 1 and 200 then
      raise exception 'Source title must be between 1 and 200 characters.';
    end if;
    if coalesce(requested_data ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other') then
      raise exception 'Invalid source_type.';
    end if;
    if requested_data ->> 'publication_date' is not null and (requested_data ->> 'publication_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Publication date must be in YYYY-MM-DD format.';
    end if;
    if requested_data ->> 'url' is not null and (requested_data ->> 'url') !~* '^https?://[^[:space:]]+$' then
      raise exception 'Source URL must use http or https protocol.';
    end if;
    return;
  end if;

  if requested_target_table = 'person_citations' then
    select array_agg(key) into unsupported_fields
    from jsonb_object_keys(requested_data) as fields(key)
    where key not in ('id', 'person_id', 'source_id', 'field_name', 'page_reference', 'quotation', 'confidence');
    if unsupported_fields is not null then
      raise exception 'Unsupported citation fields: %', array_to_string(unsupported_fields, ', ');
    end if;
    if not exists (select 1 from public.persons where id = (requested_data ->> 'person_id')::uuid) then
      raise exception 'Citation person does not exist.';
    end if;
    if not exists (select 1 from public.sources where id = (requested_data ->> 'source_id')::uuid) then
      raise exception 'Citation source does not exist.';
    end if;
    if requested_data ? 'field_name' and requested_data -> 'field_name' <> 'null'::jsonb and coalesce(requested_data ->> 'field_name', '') not in ('birth_date', 'death_date', 'relationship', 'note', 'other') then
      raise exception 'Invalid citation field_name.';
    end if;
    if coalesce(requested_data ->> 'confidence', '') not in ('primary', 'secondary', 'uncertain') then
      raise exception 'Invalid citation confidence.';
    end if;
    return;
  end if;

  raise exception 'Unsupported change request target: %', requested_target_table;
end;
$$;

revoke all on function public.validate_change_request_payload(text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.submit_change_request(
  target_table text,
  target_id uuid,
  operation text,
  proposed_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  request_id uuid;
  target_baseline timestamptz;
begin
  if caller_id is null or not public.is_active_user() then
    raise exception 'Access denied.';
  end if;

  if target_table not in ('persons', 'custom_events', 'sources', 'person_citations') then
    raise exception 'Unsupported change request target: %', target_table;
  end if;

  if target_table = 'persons' and not public.can_view_person(target_id) then
    raise exception 'Access denied.';
  end if;
  if target_table = 'custom_events' and proposed_data ->> 'person_id' is not null
     and not public.can_view_person((proposed_data ->> 'person_id')::uuid) then
    raise exception 'Access denied.';
  end if;
  if target_table = 'person_citations'
     and not public.can_view_person((proposed_data ->> 'person_id')::uuid) then
    raise exception 'Access denied.';
  end if;

  perform public.validate_change_request_payload(target_table, target_id, operation, proposed_data);

  if target_table = 'persons' and operation = 'UPDATE' then
    select updated_at into target_baseline
    from public.persons
    where id = target_id;
  end if;

  insert into public.change_requests (
    target_table,
    target_id,
    operation,
    proposed_data,
    status,
    requester_id,
    target_updated_at
  )
  values (
    target_table,
    target_id,
    operation,
    proposed_data,
    'pending',
    caller_id,
    target_baseline
  )
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.submit_change_request(text, uuid, text, jsonb) from public, anon;
grant execute on function public.submit_change_request(text, uuid, text, jsonb) to authenticated;

create or replace function public.approve_change_request(request_id uuid, note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.change_requests%rowtype;
  reviewer uuid := auth.uid();
  target_person_id uuid;
  current_target_updated_at timestamptz;
begin
  if reviewer is null or not (public.is_admin() or public.is_editor()) then
    raise exception 'Access denied.';
  end if;
  if char_length(coalesce(note, '')) > 5000 then
    raise exception 'Review note is too long.';
  end if;

  select * into request_row from public.change_requests where id = request_id for update;
  if not found then raise exception 'Change request not found.'; end if;
  if request_row.status <> 'pending' then raise exception 'Change request is not pending.'; end if;

  target_person_id := public.change_request_target_person(
    request_row.target_table,
    request_row.target_id,
    request_row.proposed_data
  );
  if target_person_id is not null and not public.can_view_person(target_person_id) then
    raise exception 'Access denied.';
  end if;

  perform public.validate_change_request_payload(request_row.target_table, request_row.target_id, request_row.operation, request_row.proposed_data);

  if request_row.target_table = 'persons' and request_row.operation = 'UPDATE' then
    select updated_at into current_target_updated_at
    from public.persons
    where id = request_row.target_id
    for update;

    if current_target_updated_at is distinct from request_row.target_updated_at then
      raise exception 'Conflict: Target data was modified after request submission.' using errcode = '40001';
    end if;
  end if;

  if request_row.target_table = 'persons' then
    update public.persons set
      full_name = case when request_row.proposed_data ? 'full_name' then request_row.proposed_data ->> 'full_name' else full_name end,
      gender = case when request_row.proposed_data ? 'gender' then (request_row.proposed_data ->> 'gender')::public.gender_enum else gender end,
      birth_year = case when request_row.proposed_data ? 'birth_year' then (request_row.proposed_data ->> 'birth_year')::integer else birth_year end,
      birth_month = case when request_row.proposed_data ? 'birth_month' then (request_row.proposed_data ->> 'birth_month')::integer else birth_month end,
      birth_day = case when request_row.proposed_data ? 'birth_day' then (request_row.proposed_data ->> 'birth_day')::integer else birth_day end,
      death_year = case when request_row.proposed_data ? 'death_year' then (request_row.proposed_data ->> 'death_year')::integer else death_year end,
      death_month = case when request_row.proposed_data ? 'death_month' then (request_row.proposed_data ->> 'death_month')::integer else death_month end,
      death_day = case when request_row.proposed_data ? 'death_day' then (request_row.proposed_data ->> 'death_day')::integer else death_day end,
      death_lunar_year = case when request_row.proposed_data ? 'death_lunar_year' then (request_row.proposed_data ->> 'death_lunar_year')::integer else death_lunar_year end,
      death_lunar_month = case when request_row.proposed_data ? 'death_lunar_month' then (request_row.proposed_data ->> 'death_lunar_month')::integer else death_lunar_month end,
      death_lunar_day = case when request_row.proposed_data ? 'death_lunar_day' then (request_row.proposed_data ->> 'death_lunar_day')::integer else death_lunar_day end,
      is_deceased = case when request_row.proposed_data ? 'is_deceased' then (request_row.proposed_data ->> 'is_deceased')::boolean else is_deceased end,
      other_names = case when request_row.proposed_data ? 'other_names' then request_row.proposed_data ->> 'other_names' else other_names end,
      note = case when request_row.proposed_data ? 'note' then request_row.proposed_data ->> 'note' else public.persons.note end
    where id = request_row.target_id;
  elsif request_row.target_table = 'custom_events' then
    insert into public.custom_events (id, name, content, event_date, location, person_id, created_by)
    values (request_row.target_id, request_row.proposed_data ->> 'name', request_row.proposed_data ->> 'content', (request_row.proposed_data ->> 'event_date')::date, request_row.proposed_data ->> 'location', (request_row.proposed_data ->> 'person_id')::uuid, request_row.requester_id);
  elsif request_row.target_table = 'sources' then
    insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
    values (request_row.target_id, request_row.proposed_data ->> 'title', request_row.proposed_data ->> 'source_type', request_row.proposed_data ->> 'author', request_row.proposed_data ->> 'publisher', (request_row.proposed_data ->> 'publication_date')::date, request_row.proposed_data ->> 'url', request_row.proposed_data ->> 'repository', request_row.proposed_data ->> 'note', request_row.requester_id);
  elsif request_row.target_table = 'person_citations' then
    insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
    values (request_row.target_id, (request_row.proposed_data ->> 'person_id')::uuid, (request_row.proposed_data ->> 'source_id')::uuid, request_row.proposed_data ->> 'field_name', request_row.proposed_data ->> 'page_reference', request_row.proposed_data ->> 'quotation', request_row.proposed_data ->> 'confidence', request_row.requester_id);
  end if;

  update public.change_requests
  set status = 'approved', reviewer_id = reviewer, review_note = nullif(btrim(note), ''), reviewed_at = now()
  where id = request_id and status = 'pending';
  if not found then raise exception 'Change request is not pending.'; end if;
  return request_id;
end;
$$;

revoke all on function public.approve_change_request(uuid, text) from public, anon;
grant execute on function public.approve_change_request(uuid, text) to authenticated;

create or replace function public.reject_change_request(request_id uuid, note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer uuid := auth.uid();
  request_row public.change_requests%rowtype;
  target_person_id uuid;
begin
  if reviewer is null or not (public.is_admin() or public.is_editor()) then
    raise exception 'Access denied.';
  end if;
  if nullif(btrim(coalesce(note, '')), '') is null then
    raise exception 'Rejection note is required.';
  end if;
  if char_length(note) > 5000 then
    raise exception 'Rejection note is too long.';
  end if;

  select * into request_row from public.change_requests where id = request_id for update;
  if not found then
    raise exception 'Change request not found or not pending.';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Change request not found or not pending.';
  end if;

  target_person_id := public.change_request_target_person(
    request_row.target_table,
    request_row.target_id,
    request_row.proposed_data
  );
  if target_person_id is not null and not public.can_view_person(target_person_id) then
    raise exception 'Access denied.';
  end if;

  update public.change_requests
  set status = 'rejected', reviewer_id = reviewer, review_note = btrim(note), reviewed_at = now()
  where id = request_id and status = 'pending';

  if not found then
    raise exception 'Change request not found or not pending.';
  end if;
  return request_id;
end;
$$;

revoke all on function public.reject_change_request(uuid, text) from public, anon;
grant execute on function public.reject_change_request(uuid, text) to authenticated;

create or replace function public.withdraw_change_request(request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or not public.is_active_user() then
    raise exception 'Access denied.';
  end if;

  update public.change_requests
  set status = 'withdrawn', withdrawn_at = now()
  where id = request_id and requester_id = caller_id and status = 'pending';

  if not found then
    raise exception 'Change request not found, already processed, or not owned by caller.';
  end if;
  return request_id;
end;
$$;

revoke all on function public.withdraw_change_request(uuid) from public, anon;
grant execute on function public.withdraw_change_request(uuid) to authenticated;
