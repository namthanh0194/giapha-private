do $$
begin
  if exists (
    select 1
    from public.relationships
    where type = 'marriage'
    group by least(person_a, person_b), greatest(person_a, person_b)
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce marriage uniqueness: reversed duplicate marriages exist.';
  end if;

  if exists (
    select 1
    from public.relationships
    where type in ('biological_child', 'adopted_child')
    group by person_a, person_b
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce child relationship uniqueness: duplicate parent-child pairs exist.';
  end if;
end;
$$;

create unique index relationships_unique_marriage_pair
on public.relationships (least(person_a, person_b), greatest(person_a, person_b))
where type = 'marriage';

create unique index relationships_unique_parent_child_pair
on public.relationships (person_a, person_b)
where type in ('biological_child', 'adopted_child');

create or replace function public.validate_relationship_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  creates_cycle boolean;
  related_by_descent boolean;
  biological_parent_count integer;
begin
  if new.person_a = new.person_b then
    raise exception 'A relationship cannot reference the same person twice.';
  end if;

  if new.type in ('biological_child', 'adopted_child') then
    with recursive edges(parent_id, child_id) as (
      select r.person_a, r.person_b
      from public.relationships r
      where r.type in ('biological_child', 'adopted_child')
        and (tg_op = 'INSERT' or r.id <> old.id)
      union all
      select new.person_a, new.person_b
    ), descendants(person_id) as (
      select new.person_b
      union
      select e.child_id
      from edges e
      join descendants d on e.parent_id = d.person_id
    )
    select exists (select 1 from descendants where person_id = new.person_a)
    into creates_cycle;

    if creates_cycle then
      raise exception 'Parent relationship would create a cycle.';
    end if;

    if new.type = 'biological_child' then
      select count(*) + 1
      into biological_parent_count
      from public.relationships r
      where r.type = 'biological_child'
        and r.person_b = new.person_b
        and (tg_op = 'INSERT' or r.id <> old.id);

      if biological_parent_count > 2 then
        raise exception 'A person cannot have more than two biological parents.';
      end if;
    end if;
  end if;

  if new.type = 'marriage' then
    with recursive descendants(start_id, person_id) as (
      select r.person_a, r.person_b
      from public.relationships r
      where r.type in ('biological_child', 'adopted_child')
      union
      select d.start_id, r.person_b
      from descendants d
      join public.relationships r on r.person_a = d.person_id
      where r.type in ('biological_child', 'adopted_child')
    )
    select exists (
      select 1 from descendants
      where (start_id = new.person_a and person_id = new.person_b)
         or (start_id = new.person_b and person_id = new.person_a)
    ) into related_by_descent;

    if related_by_descent then
      raise exception 'Marriage between an ancestor and descendant is not allowed.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_relationship_integrity_trigger on public.relationships;
create trigger validate_relationship_integrity_trigger
before insert or update of type, person_a, person_b
on public.relationships
for each row execute function public.validate_relationship_integrity();
