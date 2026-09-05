-- RPC public aggregate summary for public homepage
-- Returns only non-sensitive family overview stats

create or replace function public.get_public_homepage_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_members integer := 0;
  v_total_generations integer := 1;
  v_ancestor jsonb := null;
  v_branches jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_ancestor_id uuid := null;
begin
  -- 1. Total counts (non-sensitive numbers)
  select count(*)::integer into v_total_members
  from public.persons;

  select coalesce(max(generation), 1)::integer into v_total_generations
  from public.persons;

  -- 2. Ancestor (Generation 1, prioritize male founder)
  select p.id, jsonb_build_object('id', p.id, 'full_name', p.full_name)
  into v_ancestor_id, v_ancestor
  from public.persons p
  where p.generation = 1
  order by (case when p.gender = 'male' then 0 else 1 end), p.birth_year asc nulls last
  limit 1;

  -- If no explicit generation 1, pick root without biological parents
  if v_ancestor_id is null then
    select p.id, jsonb_build_object('id', p.id, 'full_name', p.full_name)
    into v_ancestor_id, v_ancestor
    from public.persons p
    where not exists (
      select 1 from public.relationships r
      where r.person_b = p.id and r.type in ('biological_child', 'adopted_child')
    )
    order by (case when p.gender = 'male' then 0 else 1 end), p.created_at asc
    limit 1;
  end if;

  -- 3. Branches (all direct children of the ancestor)
  if v_ancestor_id is not null then
    with recursive branch_heads as (
      select
        p.id,
        p.full_name,
        row_number() over (order by p.birth_order asc nulls last, p.birth_year asc nulls last, p.full_name asc) as branch_order
      from public.relationships r
      join public.persons p on p.id = r.person_b
      where r.person_a = v_ancestor_id
        and r.type in ('biological_child', 'adopted_child')
    ),
    branch_descendants as (
      select bh.id as branch_head_id, bh.id as person_id
      from branch_heads bh
      union all
      select bd.branch_head_id, r.person_b as person_id
      from branch_descendants bd
      join public.relationships r on r.person_a = bd.person_id
      where r.type in ('biological_child', 'adopted_child')
    ),
    branch_counts as (
      select
        bh.branch_order,
        bh.full_name as head_name,
        count(distinct bd.person_id)::integer as member_count
      from branch_heads bh
      left join branch_descendants bd on bd.branch_head_id = bh.id
      group by bh.branch_order, bh.full_name
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'name', 'Chi ' || bc.head_name,
        'description', 'Hậu duệ của ' || bc.head_name,
        'members', bc.member_count
      ) order by bc.branch_order
    ), '[]'::jsonb)
    into v_branches
    from branch_counts bc;
  end if;

  -- 4. Upcoming custom events and lunar death anniversaries
  with event_candidates as (
    select
      ce.name as title,
      to_char(ce.event_date, 'DD') as event_day,
      'Tháng ' || to_char(ce.event_date, 'MM') as event_month,
      coalesce(ce.location, 'Nhà thờ họ') as detail,
      ce.event_date as sort_date
    from public.custom_events ce
    where ce.event_date >= current_date - interval '7 days'

    union all

    select
      'Giỗ ' || p.full_name as title,
      to_char(p.death_lunar_day, 'FM00') as event_day,
      'Tháng ' || to_char(p.death_lunar_month, 'FM00') as event_month,
      'Ngày giỗ âm lịch' as detail,
      (date_trunc('year', current_date) + make_interval(months => p.death_lunar_month - 1, days => p.death_lunar_day - 1) +
        case when date_trunc('year', current_date) + make_interval(months => p.death_lunar_month - 1, days => p.death_lunar_day - 1) < current_date then interval '1 year' else interval '0' end
      )::date as sort_date
    from public.persons p
    where p.is_deceased
      and p.death_lunar_month between 1 and 12
      and p.death_lunar_day between 1 and 31
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'title', ec.title,
      'date', ec.event_day,
      'month', ec.event_month,
      'detail', ec.detail
    ) order by ec.sort_date asc
  ), '[]'::jsonb)
  into v_events
  from (select * from event_candidates order by sort_date asc limit 5) ec;

  return jsonb_build_object(
    'total_members', v_total_members,
    'total_generations', v_total_generations,
    'total_branches', jsonb_array_length(v_branches),
    'ancestor', v_ancestor,
    'branches', v_branches,
    'events', v_events
  );
end;
$$;

revoke all on function public.get_public_homepage_summary() from public;
grant execute on function public.get_public_homepage_summary() to anon, authenticated;

notify pgrst, 'reload schema';
