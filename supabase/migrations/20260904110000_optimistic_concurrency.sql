-- Optimistic concurrency for mutable domain records.

alter table public.persons add column if not exists version integer not null default 1;
alter table public.relationships add column if not exists version integer not null default 1;
alter table public.custom_events add column if not exists version integer not null default 1;
alter table public.gallery_items add column if not exists version integer not null default 1;
alter table public.sources add column if not exists version integer not null default 1;
alter table public.person_citations add column if not exists version integer not null default 1;

alter table public.persons add constraint persons_version_positive check (version >= 1) not valid;
alter table public.relationships add constraint relationships_version_positive check (version >= 1) not valid;
alter table public.custom_events add constraint custom_events_version_positive check (version >= 1) not valid;
alter table public.gallery_items add constraint gallery_items_version_positive check (version >= 1) not valid;
alter table public.sources add constraint sources_version_positive check (version >= 1) not valid;
alter table public.person_citations add constraint person_citations_version_positive check (version >= 1) not valid;

alter table public.persons validate constraint persons_version_positive;
alter table public.relationships validate constraint relationships_version_positive;
alter table public.custom_events validate constraint custom_events_version_positive;
alter table public.gallery_items validate constraint gallery_items_version_positive;
alter table public.sources validate constraint sources_version_positive;
alter table public.person_citations validate constraint person_citations_version_positive;

create or replace function public.manage_record_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  business_field text;
begin
  if new.version is distinct from old.version then
    raise exception 'Version is managed by the database.' using errcode = '22023';
  end if;

  foreach business_field in array tg_argv loop
    if to_jsonb(new) -> business_field is distinct from to_jsonb(old) -> business_field then
      new.version := old.version + 1;
      return new;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.manage_record_version() from public, anon, authenticated;

drop trigger if exists tr_version_persons on public.persons;
create trigger tr_version_persons before update on public.persons
for each row execute function public.manage_record_version(
  'full_name', 'gender', 'birth_year', 'birth_month', 'birth_day', 'death_year', 'death_month', 'death_day', 'death_lunar_year', 'death_lunar_month', 'death_lunar_day', 'is_deceased', 'is_in_law', 'birth_order', 'generation', 'other_names', 'avatar_url', 'note', 'privacy_level'
);

drop trigger if exists tr_version_relationships on public.relationships;
create trigger tr_version_relationships before update on public.relationships
for each row execute function public.manage_record_version('type', 'person_a', 'person_b', 'note');

drop trigger if exists tr_version_custom_events on public.custom_events;
create trigger tr_version_custom_events before update on public.custom_events
for each row execute function public.manage_record_version('name', 'content', 'event_date', 'location', 'person_id');

drop trigger if exists tr_version_gallery_items on public.gallery_items;
create trigger tr_version_gallery_items before update on public.gallery_items
for each row execute function public.manage_record_version('title', 'description', 'image_url', 'event_date');

drop trigger if exists tr_version_sources on public.sources;
create trigger tr_version_sources before update on public.sources
for each row execute function public.manage_record_version('title', 'source_type', 'author', 'publisher', 'publication_date', 'url', 'repository', 'note');

drop trigger if exists tr_version_person_citations on public.person_citations;
create trigger tr_version_person_citations before update on public.person_citations
for each row execute function public.manage_record_version('person_id', 'source_id', 'field_name', 'page_reference', 'quotation', 'confidence');

create or replace function public.update_versioned_record(
  target_table text,
  target_id uuid,
  expected_version integer,
  changes jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_columns text[];
  columns_sql text;
  next_version integer;
begin
  if target_id is null or expected_version is null or expected_version < 1 or changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Invalid optimistic concurrency input.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('admin', 'editor')
  ) then
    raise exception 'Access denied.';
  end if;

  allowed_columns := case target_table
    when 'persons' then array['full_name', 'gender', 'birth_year', 'birth_month', 'birth_day', 'death_year', 'death_month', 'death_day', 'death_lunar_year', 'death_lunar_month', 'death_lunar_day', 'is_deceased', 'is_in_law', 'birth_order', 'generation', 'other_names', 'avatar_url', 'note', 'privacy_level']
    when 'relationships' then array['type', 'person_a', 'person_b', 'note']
    when 'custom_events' then array['name', 'content', 'event_date', 'location', 'person_id']
    when 'gallery_items' then array['title', 'description', 'image_url', 'event_date']
    when 'sources' then array['title', 'source_type', 'author', 'publisher', 'publication_date', 'url', 'repository', 'note']
    when 'person_citations' then array['person_id', 'source_id', 'field_name', 'page_reference', 'quotation', 'confidence']
    else null
  end;

  if allowed_columns is null then
    raise exception 'Unsupported versioned table.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(changes) as key
    where key <> all(allowed_columns)
  ) then
    raise exception 'Changes include immutable or unsupported columns.' using errcode = '22023';
  end if;

  select string_agg(format('%I', column_name), ', ')
  into columns_sql
  from unnest(allowed_columns) as column_name;

  execute format(
    'update public.%1$I as target set (%2$s) = (select %2$s from jsonb_populate_record(target, $1) as payload) where target.id = $2 and target.version = $3 returning target.version',
    target_table,
    columns_sql
  )
  into next_version
  using changes, target_id, expected_version;

  if next_version is null then
    raise exception 'Concurrency conflict.' using errcode = '40001';
  end if;

  return next_version;
end;
$$;

revoke all on function public.update_versioned_record(text, uuid, integer, jsonb) from public, anon;
grant execute on function public.update_versioned_record(text, uuid, integer, jsonb) to authenticated;

create or replace function public.delete_versioned_record(
  target_table text,
  target_id uuid,
  expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  if target_id is null or expected_version is null or expected_version < 1 then
    raise exception 'Invalid optimistic concurrency input.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('admin', 'editor')
  ) then
    raise exception 'Access denied.';
  end if;

  if target_table not in ('persons', 'relationships', 'custom_events', 'gallery_items', 'sources', 'person_citations') then
    raise exception 'Unsupported versioned table.' using errcode = '22023';
  end if;

  execute format(
    'delete from public.%1$I as target where target.id = $1 and target.version = $2 returning target.id',
    target_table
  )
  into deleted_id
  using target_id, expected_version;

  if deleted_id is null then
    raise exception 'Concurrency conflict.' using errcode = '40001';
  end if;

  return 1;
end;
$$;

revoke all on function public.delete_versioned_record(text, uuid, integer) from public, anon;
grant execute on function public.delete_versioned_record(text, uuid, integer) to authenticated;

-- Upgrade source/citation edits to atomically require both observed versions.
drop function public.save_source_and_citation(jsonb, jsonb, uuid, uuid);

create function public.save_source_and_citation(
  source_payload jsonb,
  citation_payload jsonb,
  existing_source_id uuid default null,
  existing_citation_id uuid default null,
  expected_source_version integer default null,
  expected_citation_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  source_id uuid;
  citation_id uuid;
  source_version integer;
  citation_version integer;
begin
  if not exists (
    select 1 from public.profiles
    where id = caller_id and is_active and role in ('admin', 'editor')
  ) then
    raise exception 'Access denied. Only administrators and editors can save sources.';
  end if;

  if (existing_source_id is null) <> (existing_citation_id is null) then
    raise exception 'Source and citation identifiers must be provided together.';
  end if;

  if existing_source_id is null then
    if expected_source_version is not null or expected_citation_version is not null then
      raise exception 'Expected versions are only valid for edits.' using errcode = '22023';
    end if;

    insert into public.sources (title, source_type, author, publisher, publication_date, url, repository, note, created_by)
    values (source_payload ->> 'title', source_payload ->> 'source_type', nullif(source_payload ->> 'author', ''), nullif(source_payload ->> 'publisher', ''), nullif(source_payload ->> 'publication_date', '')::date, nullif(source_payload ->> 'url', ''), nullif(source_payload ->> 'repository', ''), nullif(source_payload ->> 'note', ''), caller_id)
    returning id, version into source_id, source_version;

    insert into public.person_citations (person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
    values ((citation_payload ->> 'person_id')::uuid, source_id, nullif(citation_payload ->> 'field_name', ''), nullif(citation_payload ->> 'page_reference', ''), nullif(citation_payload ->> 'quotation', ''), coalesce(nullif(citation_payload ->> 'confidence', ''), 'uncertain'), caller_id)
    returning id, version into citation_id, citation_version;
  else
    if expected_source_version is null or expected_source_version < 1 or expected_citation_version is null or expected_citation_version < 1 then
      raise exception 'Expected versions are required for edits.' using errcode = '22023';
    end if;

    update public.sources
    set title = source_payload ->> 'title', source_type = source_payload ->> 'source_type', author = nullif(source_payload ->> 'author', ''), publisher = nullif(source_payload ->> 'publisher', ''), publication_date = nullif(source_payload ->> 'publication_date', '')::date, url = nullif(source_payload ->> 'url', ''), repository = nullif(source_payload ->> 'repository', ''), note = nullif(source_payload ->> 'note', '')
    where id = existing_source_id and version = expected_source_version
    returning id, version into source_id, source_version;

    if source_id is null then
      raise exception 'Concurrency conflict.' using errcode = '40001';
    end if;

    update public.person_citations
    set person_id = (citation_payload ->> 'person_id')::uuid, field_name = nullif(citation_payload ->> 'field_name', ''), page_reference = nullif(citation_payload ->> 'page_reference', ''), quotation = nullif(citation_payload ->> 'quotation', ''), confidence = coalesce(nullif(citation_payload ->> 'confidence', ''), 'uncertain')
    where id = existing_citation_id and person_citations.source_id = existing_source_id and version = expected_citation_version
    returning id, version into citation_id, citation_version;

    if citation_id is null then
      raise exception 'Concurrency conflict.' using errcode = '40001';
    end if;
  end if;

  return jsonb_build_object('source_id', source_id, 'citation_id', citation_id, 'source_version', source_version, 'citation_version', citation_version);
end;
$$;

revoke all on function public.save_source_and_citation(jsonb, jsonb, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.save_source_and_citation(jsonb, jsonb, uuid, uuid, integer, integer) to authenticated;
