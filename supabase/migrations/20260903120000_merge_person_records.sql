create extension if not exists unaccent with schema extensions;

create or replace function public.normalize_duplicate_name(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(token, ' ' order by token), '')
  from regexp_split_to_table(
    trim(regexp_replace(replace(extensions.unaccent(lower(coalesce(input, ''))), 'đ', 'd'), '[^a-z0-9]+', ' ', 'g')),
    '\s+'
  ) as token
  where token <> '';
$$;

revoke all on function public.normalize_duplicate_name(text) from public, anon, authenticated;
grant execute on function public.normalize_duplicate_name(text) to authenticated;

create index if not exists persons_duplicate_normalized_name_idx
on public.persons (public.normalize_duplicate_name(full_name));

alter table public.custom_events add column if not exists person_id uuid references public.persons(id) on delete set null;
alter table public.gallery_items add column if not exists person_id uuid references public.persons(id) on delete set null;
create index if not exists custom_events_person_id_idx on public.custom_events (person_id) where person_id is not null;
create index if not exists gallery_items_person_id_idx on public.gallery_items (person_id) where person_id is not null;

create or replace function public.find_duplicate_candidates(candidate_limit integer default 25, candidate_offset integer default 0)
returns table (primary_person jsonb, duplicate_person jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if candidate_limit < 1 or candidate_limit > 50 or candidate_offset < 0 then
    raise exception 'Invalid duplicate candidate page.';
  end if;
  if not (public.is_admin() or public.is_editor()) then
    raise exception 'Only an admin or editor can review duplicate records.';
  end if;

  return query
  with pairs as (
    select left_person.id as left_id, right_person.id as right_id
    from public.persons left_person
    join public.persons right_person
      on right_person.id > left_person.id
      and (
        public.normalize_duplicate_name(left_person.full_name) = public.normalize_duplicate_name(right_person.full_name)
        or (left_person.birth_year is not null and left_person.birth_year = right_person.birth_year)
      )
  ), paged_pairs as (
    select left_id, right_id
    from pairs
    order by left_id, right_id
    limit candidate_limit offset candidate_offset
  )
  select
    to_jsonb(left_person) || jsonb_build_object(
      'parent_ids', coalesce((select jsonb_agg(r.person_a) from public.relationships r where r.person_b = left_person.id and r.type in ('biological_child', 'adopted_child')), '[]'::jsonb),
      'spouse_ids', coalesce((select jsonb_agg(case when r.person_a = left_person.id then r.person_b else r.person_a end) from public.relationships r where r.type = 'marriage' and left_person.id in (r.person_a, r.person_b)), '[]'::jsonb),
      'phone_number', (select d.phone_number from public.person_details_private d where d.person_id = left_person.id),
      'occupation', (select d.occupation from public.person_details_private d where d.person_id = left_person.id),
      'current_residence', (select d.current_residence from public.person_details_private d where d.person_id = left_person.id),
      'relationship_previews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'direction', case when r.person_a = left_person.id then 'outgoing' else 'incoming' end, 'related_person_id', related.id, 'related_person_name', related.full_name) order by r.id) from public.relationships r join public.persons related on related.id = case when r.person_a = left_person.id then r.person_b else r.person_a end where left_person.id in (r.person_a, r.person_b)), '[]'::jsonb),
      'citation_previews', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'source_title', s.title, 'field_name', c.field_name, 'page_reference', c.page_reference, 'quotation', c.quotation, 'confidence', c.confidence) order by c.id) from public.person_citations c join public.sources s on s.id = c.source_id where c.person_id = left_person.id), '[]'::jsonb)
    ),
    to_jsonb(right_person) || jsonb_build_object(
      'parent_ids', coalesce((select jsonb_agg(r.person_a) from public.relationships r where r.person_b = right_person.id and r.type in ('biological_child', 'adopted_child')), '[]'::jsonb),
      'spouse_ids', coalesce((select jsonb_agg(case when r.person_a = right_person.id then r.person_b else r.person_a end) from public.relationships r where r.type = 'marriage' and right_person.id in (r.person_a, r.person_b)), '[]'::jsonb),
      'phone_number', (select d.phone_number from public.person_details_private d where d.person_id = right_person.id),
      'occupation', (select d.occupation from public.person_details_private d where d.person_id = right_person.id),
      'current_residence', (select d.current_residence from public.person_details_private d where d.person_id = right_person.id),
      'relationship_previews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'direction', case when r.person_a = right_person.id then 'outgoing' else 'incoming' end, 'related_person_id', related.id, 'related_person_name', related.full_name) order by r.id) from public.relationships r join public.persons related on related.id = case when r.person_a = right_person.id then r.person_b else r.person_a end where right_person.id in (r.person_a, r.person_b)), '[]'::jsonb),
      'citation_previews', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'source_title', s.title, 'field_name', c.field_name, 'page_reference', c.page_reference, 'quotation', c.quotation, 'confidence', c.confidence) order by c.id) from public.person_citations c join public.sources s on s.id = c.source_id where c.person_id = right_person.id), '[]'::jsonb)
    )
  from paged_pairs
  join public.persons left_person on left_person.id = paged_pairs.left_id
  join public.persons right_person on right_person.id = paged_pairs.right_id
  order by paged_pairs.left_id, paged_pairs.right_id
  limit candidate_limit;
end;
$$;

revoke all on function public.find_duplicate_candidates(integer, integer) from public, anon;
grant execute on function public.find_duplicate_candidates(integer, integer) to authenticated;

alter table public.audit_log drop constraint if exists audit_log_operation_check;
alter table public.audit_log add constraint audit_log_operation_check
check (operation in ('INSERT', 'UPDATE', 'DELETE', 'MERGE'));

create or replace function public.merge_person_records(primary_id uuid, duplicate_id uuid, resolution jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_person public.persons%rowtype;
  duplicate_person public.persons%rowtype;
  field_name text;
  allowed_fields text[] := array['full_name', 'gender', 'birth_year', 'birth_month', 'birth_day', 'death_year', 'death_month', 'death_day', 'death_lunar_year', 'death_lunar_month', 'death_lunar_day', 'is_deceased', 'is_in_law', 'birth_order', 'generation', 'other_names', 'avatar_url', 'note'];
  allowed_private_fields text[] := array['phone_number', 'occupation', 'current_residence'];
  primary_details public.person_details_private%rowtype;
  duplicate_details public.person_details_private%rowtype;
  resolved_phone text;
  resolved_occupation text;
  resolved_residence text;
begin
  if primary_id is null or duplicate_id is null or primary_id = duplicate_id then
    raise exception 'Primary and duplicate must be different people.';
  end if;
  if not (public.is_admin() or public.is_editor()) then
    raise exception 'Only an admin or editor can merge people.';
  end if;
  if jsonb_typeof(coalesce(resolution, '{}'::jsonb) -> 'fields') not in ('object', null) then
    raise exception 'Merge field resolution must be an object.';
  end if;
  if jsonb_typeof(coalesce(resolution, '{}'::jsonb) -> 'private_fields') not in ('object', null) then
    raise exception 'Merge private field resolution must be an object.';
  end if;

  select * into primary_person from public.persons where id = primary_id for update;
  select * into duplicate_person from public.persons where id = duplicate_id for update;
  if not found then
    raise exception 'Duplicate person was not found.';
  end if;
  if primary_person.id is null then
    raise exception 'Primary person was not found.';
  end if;

  foreach field_name in array allowed_fields loop
    if (to_jsonb(primary_person) -> field_name) is distinct from (to_jsonb(duplicate_person) -> field_name)
       and coalesce(resolution -> 'fields' ->> field_name, '') not in ('primary', 'duplicate') then
      raise exception 'Explicit resolution required for field: %', field_name;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_each_text(coalesce(resolution -> 'fields', '{}'::jsonb)) fields(name, choice)
    where name <> all(allowed_fields) or choice not in ('primary', 'duplicate')
  ) then
    raise exception 'Invalid merge field resolution.';
  end if;
  if exists (
    select 1 from jsonb_each_text(coalesce(resolution -> 'private_fields', '{}'::jsonb)) fields(name, choice)
    where name <> all(allowed_private_fields) or choice not in ('primary', 'duplicate')
  ) then
    raise exception 'Invalid merge private field resolution.';
  end if;

  select * into primary_details from public.person_details_private where person_id = primary_id for update;
  select * into duplicate_details from public.person_details_private where person_id = duplicate_id for update;

  if primary_details.person_id is not null or duplicate_details.person_id is not null then
    foreach field_name in array allowed_private_fields loop
      if (to_jsonb(primary_details) -> field_name) is distinct from (to_jsonb(duplicate_details) -> field_name)
         and coalesce(resolution -> 'private_fields' ->> field_name, '') not in ('primary', 'duplicate') then
        raise exception 'Explicit resolution required for private field: %', field_name;
      end if;
    end loop;
  end if;

  delete from public.relationships relationship
  where duplicate_id in (relationship.person_a, relationship.person_b)
    and (
      case when relationship.person_a = duplicate_id then primary_id else relationship.person_a end
      = case when relationship.person_b = duplicate_id then primary_id else relationship.person_b end
      or exists (
        select 1 from public.relationships existing
        where existing.id <> relationship.id
          and existing.type = relationship.type
          and (
            (relationship.type = 'marriage' and least(existing.person_a, existing.person_b) = least(case when relationship.person_a = duplicate_id then primary_id else relationship.person_a end, case when relationship.person_b = duplicate_id then primary_id else relationship.person_b end) and greatest(existing.person_a, existing.person_b) = greatest(case when relationship.person_a = duplicate_id then primary_id else relationship.person_a end, case when relationship.person_b = duplicate_id then primary_id else relationship.person_b end))
            or (relationship.type <> 'marriage' and existing.person_a = case when relationship.person_a = duplicate_id then primary_id else relationship.person_a end and existing.person_b = case when relationship.person_b = duplicate_id then primary_id else relationship.person_b end)
          )
      )
    );

  update public.relationships
  set person_a = case when person_a = duplicate_id then primary_id else person_a end,
      person_b = case when person_b = duplicate_id then primary_id else person_b end
  where duplicate_id in (person_a, person_b);

  delete from public.person_citations duplicate_citation
  where duplicate_citation.person_id = duplicate_id
    and exists (
      select 1 from public.person_citations primary_citation
      where primary_citation.person_id = primary_id
        and primary_citation.source_id = duplicate_citation.source_id
        and coalesce(primary_citation.field_name, '') = coalesce(duplicate_citation.field_name, '')
        and coalesce(primary_citation.page_reference, '') = coalesce(duplicate_citation.page_reference, '')
        and coalesce(primary_citation.quotation, '') = coalesce(duplicate_citation.quotation, '')
        and primary_citation.confidence = duplicate_citation.confidence
    );
  update public.person_citations set person_id = primary_id where person_id = duplicate_id;

  if primary_details.person_id is not null or duplicate_details.person_id is not null then
    resolved_phone := case when resolution -> 'private_fields' ->> 'phone_number' = 'duplicate' then duplicate_details.phone_number else primary_details.phone_number end;
    resolved_occupation := case when resolution -> 'private_fields' ->> 'occupation' = 'duplicate' then duplicate_details.occupation else primary_details.occupation end;
    resolved_residence := case when resolution -> 'private_fields' ->> 'current_residence' = 'duplicate' then duplicate_details.current_residence else primary_details.current_residence end;
    if primary_details.person_id is not null then
      update public.person_details_private set
        phone_number = resolved_phone,
        occupation = resolved_occupation,
        current_residence = resolved_residence
      where person_id = primary_id;
    else
      insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
      values (primary_id, resolved_phone, resolved_occupation, resolved_residence);
    end if;
    delete from public.person_details_private where person_id = duplicate_id;
  end if;
  update public.custom_events set person_id = primary_id where person_id = duplicate_id;
  update public.gallery_items set person_id = primary_id where person_id = duplicate_id;

  update public.persons set
    full_name = case when resolution -> 'fields' ->> 'full_name' = 'duplicate' then duplicate_person.full_name else primary_person.full_name end,
    gender = case when resolution -> 'fields' ->> 'gender' = 'duplicate' then duplicate_person.gender else primary_person.gender end,
    birth_year = case when resolution -> 'fields' ->> 'birth_year' = 'duplicate' then duplicate_person.birth_year else primary_person.birth_year end,
    birth_month = case when resolution -> 'fields' ->> 'birth_month' = 'duplicate' then duplicate_person.birth_month else primary_person.birth_month end,
    birth_day = case when resolution -> 'fields' ->> 'birth_day' = 'duplicate' then duplicate_person.birth_day else primary_person.birth_day end,
    death_year = case when resolution -> 'fields' ->> 'death_year' = 'duplicate' then duplicate_person.death_year else primary_person.death_year end,
    death_month = case when resolution -> 'fields' ->> 'death_month' = 'duplicate' then duplicate_person.death_month else primary_person.death_month end,
    death_day = case when resolution -> 'fields' ->> 'death_day' = 'duplicate' then duplicate_person.death_day else primary_person.death_day end,
    death_lunar_year = case when resolution -> 'fields' ->> 'death_lunar_year' = 'duplicate' then duplicate_person.death_lunar_year else primary_person.death_lunar_year end,
    death_lunar_month = case when resolution -> 'fields' ->> 'death_lunar_month' = 'duplicate' then duplicate_person.death_lunar_month else primary_person.death_lunar_month end,
    death_lunar_day = case when resolution -> 'fields' ->> 'death_lunar_day' = 'duplicate' then duplicate_person.death_lunar_day else primary_person.death_lunar_day end,
    is_deceased = case when resolution -> 'fields' ->> 'is_deceased' = 'duplicate' then duplicate_person.is_deceased else primary_person.is_deceased end,
    is_in_law = case when resolution -> 'fields' ->> 'is_in_law' = 'duplicate' then duplicate_person.is_in_law else primary_person.is_in_law end,
    birth_order = case when resolution -> 'fields' ->> 'birth_order' = 'duplicate' then duplicate_person.birth_order else primary_person.birth_order end,
    generation = case when resolution -> 'fields' ->> 'generation' = 'duplicate' then duplicate_person.generation else primary_person.generation end,
    other_names = case when resolution -> 'fields' ->> 'other_names' = 'duplicate' then duplicate_person.other_names else primary_person.other_names end,
    avatar_url = case when resolution -> 'fields' ->> 'avatar_url' = 'duplicate' then duplicate_person.avatar_url else primary_person.avatar_url end,
    note = case when resolution -> 'fields' ->> 'note' = 'duplicate' then duplicate_person.note else primary_person.note end
  where id = primary_id;

  delete from public.persons where id = duplicate_id;
  insert into public.audit_log (table_name, record_id, operation, actor_user_id, new_data)
  values ('persons', primary_id, 'MERGE', auth.uid(), jsonb_build_object('action', 'merge_person_records', 'duplicate_id', duplicate_id, 'resolution', resolution, 'cannot_undo', true, 'undoable', false));
  return primary_id;
end;
$$;

revoke all on function public.merge_person_records(uuid, uuid, jsonb) from public, anon;
grant execute on function public.merge_person_records(uuid, uuid, jsonb) to authenticated;
