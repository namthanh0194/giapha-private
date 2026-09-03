alter table public.persons
  add column if not exists privacy_level text not null default 'family';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'persons_privacy_level_chk'
      and conrelid = 'public.persons'::regclass
  ) then
    alter table public.persons
      add constraint persons_privacy_level_chk
      check (privacy_level in ('family', 'editors', 'admins'));
  end if;
end
$$;

create index if not exists idx_persons_privacy_level
  on public.persons(privacy_level);

create or replace function public.can_view_person(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles requester
    where requester.id = auth.uid()
      and requester.is_active
      and (
        requester.role = 'admin'
        or exists (
          select 1
          from public.persons person
          where person.id = target_person_id
            and (
              (requester.role = 'editor' and person.privacy_level in ('family', 'editors'))
              or (requester.role = 'member' and person.privacy_level = 'family')
            )
        )
      )
  );
$$;

revoke all on function public.can_view_person(uuid) from public, anon;
grant execute on function public.can_view_person(uuid) to authenticated;

drop policy if exists "Enable read access for authenticated users" on public.persons;
drop policy if exists "Active users can view persons" on public.persons;
drop policy if exists "Authenticated users can view visible persons" on public.persons;
create policy "Authenticated users can view visible persons"
on public.persons for select to authenticated
using (public.can_view_person(id));

drop policy if exists "Enable read access for authenticated users" on public.relationships;
drop policy if exists "Active users can view relationships" on public.relationships;
drop policy if exists "Authenticated users can view visible relationships" on public.relationships;
create policy "Authenticated users can view visible relationships"
on public.relationships for select to authenticated
using (
  public.can_view_person(person_a)
  and public.can_view_person(person_b)
);

drop policy if exists "Admins can view private details" on public.person_details_private;
create policy "Admins can view private details"
on public.person_details_private for select to authenticated
using (public.is_admin() and public.can_view_person(person_id));

drop policy if exists "Active users can view custom events" on public.custom_events;
drop policy if exists "Authenticated users can view visible custom events" on public.custom_events;
create policy "Authenticated users can view visible custom events"
on public.custom_events for select to authenticated
using (
  public.is_active_user()
  and (person_id is null or public.can_view_person(person_id))
);

drop policy if exists "Active users can read person citations" on public.person_citations;
drop policy if exists "Authenticated users can read visible person citations" on public.person_citations;
create policy "Authenticated users can read visible person citations"
on public.person_citations for select to authenticated
using (public.can_view_person(person_id));

drop policy if exists "Active users can view gallery" on public.gallery_items;
drop policy if exists "Authenticated users can view visible gallery" on public.gallery_items;
create policy "Authenticated users can view visible gallery"
on public.gallery_items for select to authenticated
using (
  public.is_active_user()
  and (person_id is null or public.can_view_person(person_id))
);

drop policy if exists "Active users can view audit summaries" on public.audit_log;
drop policy if exists "Admins and editors can view audit log" on public.audit_log;
create policy "Admins and editors can view audit log"
on public.audit_log for select to authenticated
using (public.is_admin() or public.is_editor());

drop policy if exists "Avatar images are publicly accessible." on storage.objects;
drop policy if exists "Active users can view avatars" on storage.objects;
drop policy if exists "Authenticated users can view visible avatars" on storage.objects;
create policy "Authenticated users can view visible avatars"
on storage.objects for select to authenticated
using (
  bucket_id = 'avatars'
  and exists (
      select 1
      from public.persons person
      where public.can_view_person(person.id)
        and (
          person.avatar_url = name
          or person.avatar_url like '%/avatars/' || name
          or (
            name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
            and person.id = split_part(name, '/', 1)::uuid
          )
        )
    )
);

drop policy if exists "Gallery images are publicly accessible." on storage.objects;
drop policy if exists "Active users can view gallery objects" on storage.objects;
drop policy if exists "Authenticated users can view visible gallery objects" on storage.objects;
create policy "Authenticated users can view visible gallery objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'gallery'
  and exists (
      select 1
      from public.gallery_items item
      where public.is_active_user()
        and (item.person_id is null or public.can_view_person(item.person_id))
        and (item.image_url = name or item.image_url like '%/gallery/' || name)
    )
);

create or replace function public.get_family_tree_topology()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with relationship_access as (
    select
      relationship.id,
      relationship.type,
      relationship.person_a,
      relationship.person_b,
      relationship.note,
      public.can_view_person(relationship.person_a) as can_view_a,
      public.can_view_person(relationship.person_b) as can_view_b
    from public.relationships relationship
    where public.is_active_user()
      and (
        public.can_view_person(relationship.person_a)
        or public.can_view_person(relationship.person_b)
      )
  ),
  visible_nodes as (
    select jsonb_build_object(
      'id', person.id::text,
      'full_name', person.full_name,
      'gender', person.gender,
      'birth_year', person.birth_year,
      'death_year', person.death_year,
      'death_lunar_year', person.death_lunar_year,
      'avatar_url', person.avatar_url,
      'updated_at', person.updated_at,
      'is_deceased', person.is_deceased,
      'is_in_law', person.is_in_law,
      'birth_order', person.birth_order,
      'generation', person.generation,
      'is_private_placeholder', false
    ) as node
    from public.persons person
    where public.can_view_person(person.id)
  ),
  hidden_endpoints as (
    select person_a as person_id from relationship_access where not can_view_a
    union
    select person_b as person_id from relationship_access where not can_view_b
  ),
  hidden_nodes as (
    select jsonb_build_object(
      'id', 'private:' || md5(endpoint.person_id::text || ':' || auth.uid()::text),
      'full_name', 'Thành viên riêng tư',
      'gender', 'other',
      'birth_year', null,
      'death_year', null,
      'death_lunar_year', null,
      'avatar_url', null,
      'updated_at', null,
      'is_deceased', false,
      'is_in_law', false,
      'birth_order', null,
      'generation', null,
      'is_private_placeholder', true
    ) as node
    from hidden_endpoints endpoint
  ),
  topology_edges as (
    select jsonb_build_object(
      'id', 'relationship:' || md5(access.id::text || ':' || auth.uid()::text),
      'type', access.type,
      'person_a', case
        when access.can_view_a then access.person_a::text
        else 'private:' || md5(access.person_a::text || ':' || auth.uid()::text)
      end,
      'person_b', case
        when access.can_view_b then access.person_b::text
        else 'private:' || md5(access.person_b::text || ':' || auth.uid()::text)
      end,
      'note', case when access.can_view_a and access.can_view_b then access.note else null end,
      'created_at', null,
      'updated_at', null
    ) as edge
    from relationship_access access
  )
  select jsonb_build_object(
    'persons', coalesce(
      (select jsonb_agg(nodes.node order by nodes.node ->> 'id') from (
        select node from visible_nodes
        union all
        select node from hidden_nodes
      ) nodes),
      '[]'::jsonb
    ),
    'relationships', coalesce(
      (select jsonb_agg(topology_edges.edge order by topology_edges.edge ->> 'id') from topology_edges),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_family_tree_topology() from public, anon;
grant execute on function public.get_family_tree_topology() to authenticated;

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
  gallery_items_count integer;
begin
  if not public.is_admin() then
    raise exception 'Access denied. Only administrators can restore backups.';
  end if;

  if import_payload ->> 'version' not in ('3', '4', '5')
    or jsonb_typeof(import_payload -> 'persons') <> 'array'
    or jsonb_typeof(import_payload -> 'relationships') <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'person_details_private', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'custom_events', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'sources', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'person_citations', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'gallery_items', '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid backup payload.';
  end if;

  drop table if exists pg_temp.restore_persons;
  drop table if exists pg_temp.restore_relationships;
  drop table if exists pg_temp.restore_private_details;
  drop table if exists pg_temp.restore_events;
  drop table if exists pg_temp.restore_sources;
  drop table if exists pg_temp.restore_person_citations;
  drop table if exists pg_temp.restore_gallery_items;
  create temporary table restore_persons (payload jsonb not null) on commit drop;
  create temporary table restore_relationships (payload jsonb not null) on commit drop;
  create temporary table restore_private_details (payload jsonb not null) on commit drop;
  create temporary table restore_events (payload jsonb not null) on commit drop;
  create temporary table restore_sources (payload jsonb not null) on commit drop;
  create temporary table restore_person_citations (payload jsonb not null) on commit drop;
  create temporary table restore_gallery_items (payload jsonb not null) on commit drop;
  insert into restore_persons select value from jsonb_array_elements(import_payload -> 'persons');
  insert into restore_relationships select value from jsonb_array_elements(import_payload -> 'relationships');
  insert into restore_private_details select value from jsonb_array_elements(coalesce(import_payload -> 'person_details_private', '[]'::jsonb));
  insert into restore_events select value from jsonb_array_elements(coalesce(import_payload -> 'custom_events', '[]'::jsonb));
  insert into restore_sources select value from jsonb_array_elements(coalesce(import_payload -> 'sources', '[]'::jsonb));
  insert into restore_person_citations select value from jsonb_array_elements(coalesce(import_payload -> 'person_citations', '[]'::jsonb));
  insert into restore_gallery_items select value from jsonb_array_elements(coalesce(import_payload -> 'gallery_items', '[]'::jsonb));

  select count(*) into persons_count from restore_persons;
  select count(*) into relationships_count from restore_relationships;
  select count(*) into private_details_count from restore_private_details;
  select count(*) into events_count from restore_events;
  select count(*) into sources_count from restore_sources;
  select count(*) into citations_count from restore_person_citations;
  select count(*) into gallery_items_count from restore_gallery_items;
  if persons_count = 0 or persons_count > 10000 or relationships_count > 30000 or private_details_count > 10000 or events_count > 10000 or sources_count > 10000 or citations_count > 30000 or gallery_items_count > 10000 then
    raise exception 'Backup payload exceeds allowed limits.';
  end if;

  if exists (
    select 1 from restore_persons
    where coalesce(payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(payload ->> 'full_name'), '') is null
      or length(payload ->> 'full_name') > 200
      or payload ->> 'gender' not in ('male', 'female', 'other')
      or coalesce(payload ->> 'privacy_level', 'family') not in ('family', 'editors', 'admins')
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
    select 1 from restore_relationships where payload ->> 'type' = 'biological_child'
    group by payload ->> 'person_b' having count(*) > 2
  ) or exists (
    select 1 from restore_relationships where payload ->> 'type' = 'adopted_child'
    group by payload ->> 'person_b' having count(*) > 2
  ) then raise exception 'Invalid relationship in backup payload.'; end if;

  if exists (
    select 1 from restore_private_details d
    where not exists (select 1 from restore_persons p where p.payload ->> 'id' = d.payload ->> 'person_id')
      or length(coalesce(d.payload ->> 'phone_number', '')) > 30
      or length(coalesce(d.payload ->> 'occupation', '')) > 200
      or length(coalesce(d.payload ->> 'current_residence', '')) > 500
  ) or exists (
    select 1 from restore_private_details group by payload ->> 'person_id' having count(*) > 1
  ) then raise exception 'Invalid private details in backup payload.'; end if;

  if exists (
    select 1 from restore_events e
    where coalesce(e.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(e.payload ->> 'name'), '') is null
      or length(e.payload ->> 'name') > 200
      or length(coalesce(e.payload ->> 'content', '')) > 2000
      or length(coalesce(e.payload ->> 'location', '')) > 300
      or coalesce(e.payload ->> 'event_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (
        e.payload ->> 'person_id' is not null
        and not exists (
          select 1
          from restore_persons p
          where p.payload ->> 'id' = e.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_events group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid custom event in backup payload.'; end if;

  if exists (
    select 1 from restore_sources s
    where coalesce(s.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(s.payload ->> 'title'), '') is null or length(s.payload ->> 'title') > 200
      or coalesce(s.payload ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
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

  if exists (
    select 1 from restore_gallery_items item
    where coalesce(item.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(item.payload ->> 'title'), '') is null
      or length(item.payload ->> 'title') > 200
      or length(coalesce(item.payload ->> 'description', '')) > 2000
      or nullif(btrim(item.payload ->> 'image_url'), '') is null
      or length(item.payload ->> 'image_url') > 2048
      or (item.payload ->> 'event_date' is not null and item.payload ->> 'event_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items where id is not null;
  delete from public.person_citations where id is not null;
  delete from public.sources where id is not null;
  delete from public.custom_events where id is not null;
  delete from public.relationships where id is not null;
  delete from public.person_details_private where person_id is not null;
  delete from public.persons where id is not null;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
