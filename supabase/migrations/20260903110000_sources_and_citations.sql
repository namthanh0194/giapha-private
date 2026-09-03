create table public.sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null,
  author text,
  publisher text,
  publication_date date,
  url text,
  repository text,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_title_chk check (char_length(btrim(title)) between 1 and 200),
  constraint sources_source_type_chk check (source_type in ('document', 'book', 'oral_history', 'website', 'photo', 'other')),
  constraint sources_author_length_chk check (author is null or char_length(author) <= 300),
  constraint sources_publisher_length_chk check (publisher is null or char_length(publisher) <= 300),
  constraint sources_url_length_chk check (url is null or char_length(url) <= 2048),
  constraint sources_url_protocol_chk check (url is null or url ~* '^https?://[^[:space:]]+$'),
  constraint sources_repository_length_chk check (repository is null or char_length(repository) <= 500),
  constraint sources_note_length_chk check (note is null or char_length(note) <= 5000)
);

create table public.person_citations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  field_name text,
  page_reference text,
  quotation text,
  confidence text not null default 'uncertain',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint person_citations_field_name_chk check (field_name is null or field_name in ('birth_date', 'death_date', 'relationship', 'note', 'other')),
  constraint person_citations_page_reference_length_chk check (page_reference is null or char_length(page_reference) <= 300),
  constraint person_citations_quotation_length_chk check (quotation is null or char_length(quotation) <= 5000),
  constraint person_citations_confidence_chk check (confidence in ('primary', 'secondary', 'uncertain'))
);

create index idx_sources_title on public.sources(title);
create index idx_sources_type on public.sources(source_type);
create index idx_person_citations_person_id on public.person_citations(person_id);
create index idx_person_citations_source_id on public.person_citations(source_id);
create unique index person_citations_identical_uidx
  on public.person_citations (
    person_id,
    source_id,
    coalesce(field_name, ''),
    coalesce(page_reference, ''),
    coalesce(quotation, ''),
    confidence
  );

create trigger tr_sources_updated_at
before update on public.sources
for each row execute procedure public.handle_updated_at();

create or replace function public.prevent_source_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Sources created_by cannot be modified.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_source_owner_change() from public, anon, authenticated;

create trigger prevent_source_owner_change_trigger
before update of created_by on public.sources
for each row execute function public.prevent_source_owner_change();

create or replace function public.prevent_citation_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Person citations created_by cannot be modified.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_citation_owner_change() from public, anon, authenticated;

create trigger prevent_citation_owner_change_trigger
before update of created_by on public.person_citations
for each row execute function public.prevent_citation_owner_change();

alter table public.sources enable row level security;
alter table public.person_citations enable row level security;

revoke all on table public.sources from public, anon;
revoke all on table public.person_citations from public, anon;
grant select, insert, update, delete on table public.sources to authenticated;
grant select, insert, update, delete on table public.person_citations to authenticated;

create policy "Active users can read sources"
on public.sources for select to authenticated
using (public.is_active_user());

create policy "Admins and editors can insert sources"
on public.sources for insert to authenticated
with check ((public.is_admin() or public.is_editor()) and auth.uid() = created_by);

create policy "Admins and editors can update sources"
on public.sources for update to authenticated
using (public.is_admin() or public.is_editor())
with check (public.is_admin() or public.is_editor());

create policy "Admins and editors can delete sources"
on public.sources for delete to authenticated
using (public.is_admin() or public.is_editor());

create policy "Active users can read person citations"
on public.person_citations for select to authenticated
using (public.is_active_user());

create policy "Admins and editors can insert person citations"
on public.person_citations for insert to authenticated
with check ((public.is_admin() or public.is_editor()) and auth.uid() = created_by);

create policy "Admins and editors can update person citations"
on public.person_citations for update to authenticated
using (public.is_admin() or public.is_editor())
with check (public.is_admin() or public.is_editor());

create policy "Admins and editors can delete person citations"
on public.person_citations for delete to authenticated
using (public.is_admin() or public.is_editor());

create or replace function public.save_source_and_citation(
  source_payload jsonb,
  citation_payload jsonb,
  existing_source_id uuid default null,
  existing_citation_id uuid default null
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
begin
  if not exists (
    select 1
    from public.profiles
    where id = caller_id
      and is_active
      and role in ('admin', 'editor')
  ) then
    raise exception 'Access denied. Only administrators and editors can save sources.';
  end if;

  if (existing_source_id is null) <> (existing_citation_id is null) then
    raise exception 'Source and citation identifiers must be provided together.';
  end if;

  if existing_source_id is null then
    insert into public.sources (
      title, source_type, author, publisher, publication_date, url, repository, note, created_by
    ) values (
      source_payload ->> 'title',
      source_payload ->> 'source_type',
      nullif(source_payload ->> 'author', ''),
      nullif(source_payload ->> 'publisher', ''),
      nullif(source_payload ->> 'publication_date', '')::date,
      nullif(source_payload ->> 'url', ''),
      nullif(source_payload ->> 'repository', ''),
      nullif(source_payload ->> 'note', ''),
      caller_id
    ) returning id into source_id;

    insert into public.person_citations (
      person_id, source_id, field_name, page_reference, quotation, confidence, created_by
    ) values (
      (citation_payload ->> 'person_id')::uuid,
      source_id,
      nullif(citation_payload ->> 'field_name', ''),
      nullif(citation_payload ->> 'page_reference', ''),
      nullif(citation_payload ->> 'quotation', ''),
      coalesce(nullif(citation_payload ->> 'confidence', ''), 'uncertain'),
      caller_id
    ) returning id into citation_id;
  else
    update public.sources
    set
      title = source_payload ->> 'title',
      source_type = source_payload ->> 'source_type',
      author = nullif(source_payload ->> 'author', ''),
      publisher = nullif(source_payload ->> 'publisher', ''),
      publication_date = nullif(source_payload ->> 'publication_date', '')::date,
      url = nullif(source_payload ->> 'url', ''),
      repository = nullif(source_payload ->> 'repository', ''),
      note = nullif(source_payload ->> 'note', '')
    where id = existing_source_id
    returning id into source_id;

    if source_id is null then
      raise exception 'Source not found or not writable.';
    end if;

    update public.person_citations
    set
      person_id = (citation_payload ->> 'person_id')::uuid,
      field_name = nullif(citation_payload ->> 'field_name', ''),
      page_reference = nullif(citation_payload ->> 'page_reference', ''),
      quotation = nullif(citation_payload ->> 'quotation', ''),
      confidence = coalesce(nullif(citation_payload ->> 'confidence', ''), 'uncertain')
    where id = existing_citation_id
      and public.person_citations.source_id = existing_source_id
    returning id into citation_id;

    if citation_id is null then
      raise exception 'Citation not found or does not belong to the source.';
    end if;
  end if;

  return jsonb_build_object('source_id', source_id, 'citation_id', citation_id);
end;
$$;

revoke all on function public.save_source_and_citation(jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.save_source_and_citation(jsonb, jsonb, uuid, uuid) to authenticated;

create or replace function public.restore_backup(import_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  persons_count integer;
  relationships_count integer;
  private_details_count integer;
  events_count integer;
  sources_count integer;
  citations_count integer;
begin
  if not public.is_admin() then
    raise exception 'Access denied. Only administrators can restore backups.';
  end if;

  if import_payload ->> 'version' not in ('3', '4')
    or jsonb_typeof(import_payload -> 'persons') <> 'array'
    or jsonb_typeof(import_payload -> 'relationships') <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'person_details_private', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'custom_events', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'sources', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'person_citations', '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid backup payload.';
  end if;

  drop table if exists pg_temp.restore_persons;
  drop table if exists pg_temp.restore_relationships;
  drop table if exists pg_temp.restore_private_details;
  drop table if exists pg_temp.restore_events;
  drop table if exists pg_temp.restore_sources;
  drop table if exists pg_temp.restore_person_citations;
  create temporary table restore_persons (payload jsonb not null) on commit drop;
  create temporary table restore_relationships (payload jsonb not null) on commit drop;
  create temporary table restore_private_details (payload jsonb not null) on commit drop;
  create temporary table restore_events (payload jsonb not null) on commit drop;
  create temporary table restore_sources (payload jsonb not null) on commit drop;
  create temporary table restore_person_citations (payload jsonb not null) on commit drop;
  insert into restore_persons select value from jsonb_array_elements(import_payload -> 'persons');
  insert into restore_relationships select value from jsonb_array_elements(import_payload -> 'relationships');
  insert into restore_private_details select value from jsonb_array_elements(coalesce(import_payload -> 'person_details_private', '[]'::jsonb));
  insert into restore_events select value from jsonb_array_elements(coalesce(import_payload -> 'custom_events', '[]'::jsonb));
  insert into restore_sources select value from jsonb_array_elements(coalesce(import_payload -> 'sources', '[]'::jsonb));
  insert into restore_person_citations select value from jsonb_array_elements(coalesce(import_payload -> 'person_citations', '[]'::jsonb));

  select count(*) into persons_count from restore_persons;
  select count(*) into relationships_count from restore_relationships;
  select count(*) into private_details_count from restore_private_details;
  select count(*) into events_count from restore_events;
  select count(*) into sources_count from restore_sources;
  select count(*) into citations_count from restore_person_citations;
  if persons_count = 0 or persons_count > 10000 or relationships_count > 30000 or private_details_count > 10000 or events_count > 10000 or sources_count > 10000 or citations_count > 30000 then
    raise exception 'Backup payload exceeds allowed limits.';
  end if;

  if exists (
    select 1 from restore_persons
    where coalesce(payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(payload ->> 'full_name'), '') is null
      or length(payload ->> 'full_name') > 200
      or payload ->> 'gender' not in ('male', 'female', 'other')
  ) or exists (
    select 1 from restore_persons group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid person in backup payload.'; end if;

  if exists (
    select 1 from restore_relationships r
    where coalesce(r.payload ->> 'type', '') not in ('marriage', 'biological_child', 'adopted_child')
      or coalesce(r.payload ->> 'person_a', '') = coalesce(r.payload ->> 'person_b', '')
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = r.payload ->> 'person_a')
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = r.payload ->> 'person_b')
  ) or exists (
    select 1 from restore_relationships group by payload ->> 'type', payload ->> 'person_a', payload ->> 'person_b' having count(*) > 1
  ) or exists (
    select 1 from restore_relationships group by least(payload ->> 'person_a', payload ->> 'person_b'), greatest(payload ->> 'person_a', payload ->> 'person_b')
    having bool_or(payload ->> 'type' = 'biological_child') and bool_or(payload ->> 'type' = 'adopted_child')
  ) or exists (
    select 1 from restore_relationships where payload ->> 'type' = 'biological_child' group by payload ->> 'person_b' having count(*) > 2
  ) or exists (
    select 1 from restore_relationships a join restore_relationships b
      on a.payload ->> 'type' in ('biological_child', 'adopted_child') and b.payload ->> 'type' in ('biological_child', 'adopted_child')
      and a.payload ->> 'person_a' = b.payload ->> 'person_b' and a.payload ->> 'person_b' = b.payload ->> 'person_a'
  ) or exists (
    select 1 from restore_relationships where payload ->> 'type' = 'marriage'
    group by least(payload ->> 'person_a', payload ->> 'person_b'), greatest(payload ->> 'person_a', payload ->> 'person_b') having count(*) > 1
  ) then raise exception 'Invalid relationship in backup payload.'; end if;

  if exists (
    select 1 from restore_private_details d
    where not exists (select 1 from restore_persons p where p.payload ->> 'id' = d.payload ->> 'person_id')
      or length(coalesce(d.payload ->> 'phone_number', '')) > 500
      or length(coalesce(d.payload ->> 'occupation', '')) > 500
      or length(coalesce(d.payload ->> 'current_residence', '')) > 500
  ) then raise exception 'Invalid private detail in backup payload.'; end if;

  if exists (
    select 1 from restore_events
    where coalesce(payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(payload ->> 'name'), '') is null or length(payload ->> 'name') > 200
      or length(coalesce(payload ->> 'content', '')) > 2000 or length(coalesce(payload ->> 'location', '')) > 2000
      or (payload ->> 'event_date') is null
  ) or exists (select 1 from restore_events group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid custom event in backup payload.';
  end if;

  if exists (
    select 1 from restore_sources
    where coalesce(payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(payload ->> 'title'), '') is null or length(payload ->> 'title') > 200
      or payload ->> 'source_type' not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
      or length(coalesce(payload ->> 'author', '')) > 300 or length(coalesce(payload ->> 'publisher', '')) > 300
      or length(coalesce(payload ->> 'url', '')) > 2048 or (payload ->> 'url' is not null and payload ->> 'url' !~* '^https?://[^[:space:]]+$')
      or length(coalesce(payload ->> 'repository', '')) > 500 or length(coalesce(payload ->> 'note', '')) > 5000
  ) or exists (select 1 from restore_sources group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid source in backup payload.';
  end if;

  if exists (
    select 1 from restore_person_citations c
    where coalesce(c.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = c.payload ->> 'person_id')
      or not exists (select 1 from restore_sources s where s.payload ->> 'id' = c.payload ->> 'source_id')
      or (c.payload ->> 'field_name' is not null and c.payload ->> 'field_name' not in ('birth_date', 'death_date', 'relationship', 'note', 'other'))
      or length(coalesce(c.payload ->> 'page_reference', '')) > 300 or length(coalesce(c.payload ->> 'quotation', '')) > 5000
      or c.payload ->> 'confidence' not in ('primary', 'secondary', 'uncertain')
  ) or exists (select 1 from restore_person_citations group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid person citation in backup payload.';
  end if;

  delete from public.person_citations where id is not null;
  delete from public.sources where id is not null;
  delete from public.custom_events where id is not null;
  delete from public.relationships where id is not null;
  delete from public.person_details_private where person_id is not null;
  delete from public.persons where id is not null;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note' from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
