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
begin
  if not public.is_admin() then
    raise exception 'Access denied. Only administrators can restore backups.';
  end if;

  if import_payload ->> 'version' <> '3'
    or jsonb_typeof(import_payload -> 'persons') <> 'array'
    or jsonb_typeof(import_payload -> 'relationships') <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'person_details_private', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'custom_events', '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid backup payload.';
  end if;

  drop table if exists pg_temp.restore_persons;
  drop table if exists pg_temp.restore_relationships;
  drop table if exists pg_temp.restore_private_details;
  drop table if exists pg_temp.restore_events;
  create temporary table restore_persons (payload jsonb not null) on commit drop;
  create temporary table restore_relationships (payload jsonb not null) on commit drop;
  create temporary table restore_private_details (payload jsonb not null) on commit drop;
  create temporary table restore_events (payload jsonb not null) on commit drop;
  insert into restore_persons select value from jsonb_array_elements(import_payload -> 'persons');
  insert into restore_relationships select value from jsonb_array_elements(import_payload -> 'relationships');
  insert into restore_private_details select value from jsonb_array_elements(coalesce(import_payload -> 'person_details_private', '[]'::jsonb));
  insert into restore_events select value from jsonb_array_elements(coalesce(import_payload -> 'custom_events', '[]'::jsonb));

  select count(*) into persons_count from restore_persons;
  select count(*) into relationships_count from restore_relationships;
  select count(*) into private_details_count from restore_private_details;
  select count(*) into events_count from restore_events;
  if persons_count = 0 or persons_count > 10000 or relationships_count > 30000 or private_details_count > 10000 or events_count > 10000 then
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
    select 1 from restore_relationships
    where payload ->> 'type' = 'marriage'
    group by least(payload ->> 'person_a', payload ->> 'person_b'), greatest(payload ->> 'person_a', payload ->> 'person_b') having count(*) > 1
  ) then raise exception 'Invalid relationship in backup payload.'; end if;

  if exists (
    select 1 from restore_private_details d
    where not exists (select 1 from restore_persons p where p.payload ->> 'id' = d.payload ->> 'person_id')
      or length(coalesce(d.payload ->> 'phone_number', '')) > 500
      or length(coalesce(d.payload ->> 'occupation', '')) > 500
      or length(coalesce(d.payload ->> 'current_residence', '')) > 500
  ) or exists (select 1 from restore_private_details group by payload ->> 'person_id' having count(*) > 1) then
    raise exception 'Invalid private detail in backup payload.';
  end if;

  if exists (
    select 1 from restore_events
    where coalesce(payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(payload ->> 'name'), '') is null or length(payload ->> 'name') > 200
      or length(coalesce(payload ->> 'content', '')) > 2000 or length(coalesce(payload ->> 'location', '')) > 2000
      or (payload ->> 'event_date') is null
  ) or exists (select 1 from restore_events group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid custom event in backup payload.';
  end if;

  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note' from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id from restore_events;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
