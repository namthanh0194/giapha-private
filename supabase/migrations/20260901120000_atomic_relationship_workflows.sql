create or replace function public.create_spouse(
  person_id uuid,
  spouse jsonb,
  relationship_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  spouse_id uuid;
begin
  if not (public.is_admin() or public.is_editor()) then
    raise exception 'Access denied. Only administrators and editors can create relationships.';
  end if;
  if not exists (select 1 from public.persons where id = person_id) then
    raise exception 'Person not found.';
  end if;
  if nullif(btrim(spouse ->> 'full_name'), '') is null or length(spouse ->> 'full_name') > 200 then
    raise exception 'Invalid spouse name.';
  end if;
  if spouse ->> 'gender' not in ('male', 'female', 'other') then
    raise exception 'Invalid spouse gender.';
  end if;
  if relationship_note is not null and length(relationship_note) > 2000 then
    raise exception 'Relationship note is too long.';
  end if;
  if spouse ? 'birth_year' and (spouse ->> 'birth_year')::integer not between 1 and 9999 then
    raise exception 'Invalid spouse birth year.';
  end if;
  if spouse ? 'generation' and (spouse ->> 'generation')::integer < 1 then
    raise exception 'Invalid spouse generation.';
  end if;

  insert into public.persons (
    full_name, gender, birth_year, birth_order, generation, is_in_law,
    is_deceased, other_names, avatar_url, note
  ) values (
    btrim(spouse ->> 'full_name'),
    (spouse ->> 'gender')::public.gender_enum,
    (spouse ->> 'birth_year')::integer,
    (spouse ->> 'birth_order')::integer,
    (spouse ->> 'generation')::integer,
    coalesce((spouse ->> 'is_in_law')::boolean, true),
    coalesce((spouse ->> 'is_deceased')::boolean, false),
    spouse ->> 'other_names',
    spouse ->> 'avatar_url',
    spouse ->> 'note'
  ) returning id into spouse_id;

  insert into public.relationships (type, person_a, person_b, note)
  values ('marriage', person_id, spouse_id, relationship_note);

  return spouse_id;
end;
$$;

create or replace function public.create_children(
  parent_ids uuid[],
  children jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  child jsonb;
  child_id uuid;
  parent_id uuid;
  created_ids uuid[] := array[]::uuid[];
  child_count integer;
begin
  if not (public.is_admin() or public.is_editor()) then
    raise exception 'Access denied. Only administrators and editors can create relationships.';
  end if;
  if coalesce(array_length(parent_ids, 1), 0) not between 1 and 2
    or (select count(distinct value) from unnest(parent_ids) value) <> array_length(parent_ids, 1) then
    raise exception 'One or two unique parent IDs are required.';
  end if;
  if exists (select 1 from unnest(parent_ids) value where not exists (select 1 from public.persons where id = value)) then
    raise exception 'Parent not found.';
  end if;
  if jsonb_typeof(children) <> 'array' then
    raise exception 'Children must be an array.';
  end if;
  child_count := jsonb_array_length(children);
  if child_count not between 1 and 100 then
    raise exception 'Children array must contain between 1 and 100 items.';
  end if;

  for child in select value from jsonb_array_elements(children)
  loop
    if nullif(btrim(child ->> 'full_name'), '') is null or length(child ->> 'full_name') > 200 then
      raise exception 'Invalid child name.';
    end if;
    if child ->> 'gender' not in ('male', 'female', 'other') then
      raise exception 'Invalid child gender.';
    end if;
    if child ? 'birth_year' and (child ->> 'birth_year')::integer not between 1 and 9999 then
      raise exception 'Invalid child birth year.';
    end if;
    if child ? 'generation' and (child ->> 'generation')::integer < 1 then
      raise exception 'Invalid child generation.';
    end if;
  end loop;

  for child in select value from jsonb_array_elements(children)
  loop
    insert into public.persons (
      full_name, gender, birth_year, birth_order, generation,
      is_in_law, is_deceased, other_names, avatar_url, note
    ) values (
      btrim(child ->> 'full_name'),
      (child ->> 'gender')::public.gender_enum,
      (child ->> 'birth_year')::integer,
      (child ->> 'birth_order')::integer,
      (child ->> 'generation')::integer,
      false,
      coalesce((child ->> 'is_deceased')::boolean, false),
      child ->> 'other_names',
      child ->> 'avatar_url',
      child ->> 'note'
    ) returning id into child_id;

    foreach parent_id in array parent_ids
    loop
      insert into public.relationships (type, person_a, person_b)
      values ('biological_child', parent_id, child_id);
    end loop;
    created_ids := array_append(created_ids, child_id);
  end loop;

  return jsonb_build_object('created', child_count, 'ids', to_jsonb(created_ids));
end;
$$;

revoke all on function public.create_spouse(uuid, jsonb, text) from public, anon;
revoke all on function public.create_children(uuid[], jsonb) from public, anon;
grant execute on function public.create_spouse(uuid, jsonb, text) to authenticated;
grant execute on function public.create_children(uuid[], jsonb) to authenticated;
