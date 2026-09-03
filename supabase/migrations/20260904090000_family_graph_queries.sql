create or replace function public.get_family_subtree(root_id uuid, max_depth integer, include_spouses boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  person_limit constant integer := 2000;
  relationship_limit constant integer := 6000;
begin
  if max_depth not between 1 and 10 then
    raise exception 'max_depth must be between 1 and 10';
  end if;

  if root_id is null or not public.can_view_person(root_id) then
    return jsonb_build_object('persons', '[]'::jsonb, 'relationships', '[]'::jsonb, 'truncated', false, 'maxDepth', max_depth);
  end if;

  return (
    with recursive descendants(person_id, depth, path) as (
      select root_id, 0, array[root_id]
      union all
      select relationship.person_b, descendants.depth + 1, descendants.path || relationship.person_b
      from descendants
      join public.relationships relationship
        on relationship.person_a = descendants.person_id
        and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
      where descendants.depth < max_depth
        and not relationship.person_b = any(descendants.path)
    ),
    traversal_people as (
      select person_id, min(depth) as depth
      from descendants
      group by person_id
    ),
    spouse_people as (
      select case when relationship.person_a = traversal.person_id then relationship.person_b else relationship.person_a end as person_id,
        traversal.depth
      from traversal_people traversal
      join public.relationships relationship
        on include_spouses
        and relationship.type = 'marriage'::public.relationship_type_enum
        and traversal.person_id in (relationship.person_a, relationship.person_b)
    ),
    candidate_people as (
      select person_id, depth from traversal_people
      union
      select person_id, depth from spouse_people
    ),
    bounded_people as (
      select person_id
      from candidate_people
      group by person_id
      order by min(depth), person_id
      limit person_limit
    ),
    relationship_access as (
      select relationship.*, public.can_view_person(relationship.person_a) as can_view_a, public.can_view_person(relationship.person_b) as can_view_b
      from public.relationships relationship
      where relationship.person_a in (select person_id from bounded_people)
        and relationship.person_b in (select person_id from bounded_people)
        and (public.can_view_person(relationship.person_a) or public.can_view_person(relationship.person_b))
        and (
          relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
          or include_spouses
        )
    ),
    bounded_relationships as (
      select * from relationship_access order by id limit relationship_limit
    ),
    visible_nodes as (
      select jsonb_build_object(
        'id', person.id::text, 'full_name', person.full_name, 'gender', person.gender,
        'birth_year', person.birth_year, 'death_year', person.death_year, 'death_lunar_year', person.death_lunar_year,
        'avatar_url', person.avatar_url, 'updated_at', person.updated_at, 'is_deceased', person.is_deceased,
        'is_in_law', person.is_in_law, 'birth_order', person.birth_order, 'generation', person.generation,
        'is_private_placeholder', false
      ) as node
      from public.persons person
      where person.id in (select person_id from bounded_people)
        and public.can_view_person(person.id)
    ),
    hidden_nodes as (
      select jsonb_build_object(
        'id', 'private:' || md5(person_id::text || ':' || auth.uid()::text), 'full_name', 'Thành viên riêng tư',
        'gender', 'other', 'birth_year', null, 'death_year', null, 'death_lunar_year', null, 'avatar_url', null,
        'updated_at', null, 'is_deceased', false, 'is_in_law', false, 'birth_order', null, 'generation', null,
        'is_private_placeholder', true
      ) as node
      from bounded_people
      where not public.can_view_person(person_id)
    ),
    graph_edges as (
      select jsonb_build_object(
        'id', 'relationship:' || md5(relationship.id::text || ':' || auth.uid()::text), 'type', relationship.type,
        'person_a', case when relationship.can_view_a then relationship.person_a::text else 'private:' || md5(relationship.person_a::text || ':' || auth.uid()::text) end,
        'person_b', case when relationship.can_view_b then relationship.person_b::text else 'private:' || md5(relationship.person_b::text || ':' || auth.uid()::text) end,
        'note', case when relationship.can_view_a and relationship.can_view_b then relationship.note else null end,
        'created_at', null, 'updated_at', null
      ) as edge
      from bounded_relationships relationship
    )
    select jsonb_build_object(
      'persons', coalesce((select jsonb_agg(node order by node ->> 'id') from (select node from visible_nodes union all select node from hidden_nodes) nodes), '[]'::jsonb),
      'relationships', coalesce((select jsonb_agg(edge order by edge ->> 'id') from graph_edges), '[]'::jsonb),
      'truncated',
        exists (select 1 from candidate_people offset person_limit)
        or exists (select 1 from relationship_access offset relationship_limit)
        or exists (
          select 1
          from traversal_people traversal
          join public.relationships relationship
            on relationship.person_a = traversal.person_id
            and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
          where traversal.depth = max_depth
        ),
      'maxDepth', max_depth
    )
  );
end;
$$;

create or replace function public.get_person_neighborhood(person_id uuid, ancestor_depth integer, descendant_depth integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  person_limit constant integer := 2000;
  relationship_limit constant integer := 6000;
begin
  if ancestor_depth not between 1 and 10 or descendant_depth not between 1 and 10 then
    raise exception 'depth must be between 1 and 10';
  end if;

  if $1 is null or not public.can_view_person($1) then
    return jsonb_build_object('persons', '[]'::jsonb, 'relationships', '[]'::jsonb, 'truncated', false, 'maxDepth', greatest(ancestor_depth, descendant_depth));
  end if;

  return (
    with recursive ancestors(person_id, depth, path) as (
      select $1, 0, array[$1]
      union all
      select relationship.person_a, ancestors.depth + 1, ancestors.path || relationship.person_a
      from ancestors
      join public.relationships relationship
        on relationship.person_b = ancestors.person_id
        and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
      where ancestors.depth < ancestor_depth and not relationship.person_a = any(ancestors.path)
    ),
    descendants(person_id, depth, path) as (
      select $1, 0, array[$1]
      union all
      select relationship.person_b, descendants.depth + 1, descendants.path || relationship.person_b
      from descendants
      join public.relationships relationship
        on relationship.person_a = descendants.person_id
        and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
      where descendants.depth < descendant_depth and not relationship.person_b = any(descendants.path)
    ),
    candidate_people as (
      select person_id, min(depth) as distance
      from (select person_id, depth from ancestors union all select person_id, depth from descendants) graph_people
      group by person_id
    ),
    bounded_people as (
      select person_id from candidate_people order by distance, person_id limit person_limit
    ),
    relationship_access as (
      select relationship.*, public.can_view_person(relationship.person_a) as can_view_a, public.can_view_person(relationship.person_b) as can_view_b
      from public.relationships relationship
      where relationship.person_a in (select person_id from bounded_people)
        and relationship.person_b in (select person_id from bounded_people)
        and (public.can_view_person(relationship.person_a) or public.can_view_person(relationship.person_b))
    ),
    bounded_relationships as (
      select * from relationship_access order by id limit relationship_limit
    ),
    visible_nodes as (
      select jsonb_build_object(
        'id', person.id::text, 'full_name', person.full_name, 'gender', person.gender,
        'birth_year', person.birth_year, 'death_year', person.death_year, 'death_lunar_year', person.death_lunar_year,
        'avatar_url', person.avatar_url, 'updated_at', person.updated_at, 'is_deceased', person.is_deceased,
        'is_in_law', person.is_in_law, 'birth_order', person.birth_order, 'generation', person.generation,
        'is_private_placeholder', false
      ) as node
      from public.persons person
      where person.id in (select person_id from bounded_people) and public.can_view_person(person.id)
    ),
    hidden_nodes as (
      select jsonb_build_object(
        'id', 'private:' || md5(person_id::text || ':' || auth.uid()::text), 'full_name', 'Thành viên riêng tư',
        'gender', 'other', 'birth_year', null, 'death_year', null, 'death_lunar_year', null, 'avatar_url', null,
        'updated_at', null, 'is_deceased', false, 'is_in_law', false, 'birth_order', null, 'generation', null,
        'is_private_placeholder', true
      ) as node
      from bounded_people where not public.can_view_person(person_id)
    ),
    graph_edges as (
      select jsonb_build_object(
        'id', 'relationship:' || md5(relationship.id::text || ':' || auth.uid()::text), 'type', relationship.type,
        'person_a', case when relationship.can_view_a then relationship.person_a::text else 'private:' || md5(relationship.person_a::text || ':' || auth.uid()::text) end,
        'person_b', case when relationship.can_view_b then relationship.person_b::text else 'private:' || md5(relationship.person_b::text || ':' || auth.uid()::text) end,
        'note', case when relationship.can_view_a and relationship.can_view_b then relationship.note else null end,
        'created_at', null, 'updated_at', null
      ) as edge
      from bounded_relationships relationship
    )
    select jsonb_build_object(
      'persons', coalesce((select jsonb_agg(node order by node ->> 'id') from (select node from visible_nodes union all select node from hidden_nodes) nodes), '[]'::jsonb),
      'relationships', coalesce((select jsonb_agg(edge order by edge ->> 'id') from graph_edges), '[]'::jsonb),
      'truncated', exists (select 1 from candidate_people offset person_limit) or exists (select 1 from relationship_access offset relationship_limit),
      'maxDepth', greatest(ancestor_depth, descendant_depth)
    )
  );
end;
$$;

revoke all on function public.get_family_subtree(uuid, integer, boolean) from public, anon;
revoke all on function public.get_person_neighborhood(uuid, integer, integer) from public, anon;
grant execute on function public.get_family_subtree(uuid, integer, boolean) to authenticated;
grant execute on function public.get_person_neighborhood(uuid, integer, integer) to authenticated;
