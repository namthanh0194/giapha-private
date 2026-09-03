create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function public.normalize_person_search(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select regexp_replace(lower(extensions.unaccent(value)), '\s+', ' ', 'g');
$$;

alter table public.persons
  add column if not exists search_normalized text
  generated always as (
    public.normalize_person_search(full_name || coalesce(' ' || other_names, ''))
  ) stored;

create index if not exists idx_persons_search_trgm
  on public.persons using gin (search_normalized extensions.gin_trgm_ops);

create or replace function public.search_persons(query text, result_limit integer default 20)
returns table (
  id text,
  full_name text,
  gender public.gender_enum,
  birth_year integer,
  avatar_url text,
  is_private_placeholder boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text;
begin
  if query is null then
    raise exception 'query_length_invalid' using errcode = '22023';
  end if;

  normalized_query := public.normalize_person_search(trim(query));

  if normalized_query is null or char_length(normalized_query) not between 2 and 100 then
    raise exception 'query_length_invalid' using errcode = '22023';
  end if;

  if result_limit not between 1 and 20 then
    raise exception 'result_limit_invalid' using errcode = '22023';
  end if;

  if not public.is_active_user() then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return query
  with matched_people as (
    select
      person.*,
      public.can_view_person(person.id) as can_view,
      case
        when public.normalize_person_search(person.full_name) = normalized_query then 0
        when public.normalize_person_search(person.full_name) like normalized_query || '%' then 1
        else 2
      end as match_kind,
      greatest(
        extensions.similarity(public.normalize_person_search(person.full_name), normalized_query),
        extensions.similarity(person.search_normalized, normalized_query)
      ) as match_similarity
    from public.persons person
    where person.search_normalized like '%' || normalized_query || '%'
  )
  select
    case
      when matched_people.can_view then matched_people.id::text
      else 'private:' || md5(matched_people.id::text || ':' || auth.uid()::text)
    end,
    case when matched_people.can_view then matched_people.full_name else 'Thành viên riêng tư' end,
    case when matched_people.can_view then matched_people.gender else 'other'::public.gender_enum end,
    case when matched_people.can_view then matched_people.birth_year else null end,
    case when matched_people.can_view then matched_people.avatar_url else null end,
    not matched_people.can_view
  from matched_people
  order by matched_people.match_kind, matched_people.match_similarity desc, matched_people.full_name, matched_people.id
  limit result_limit;
end;
$$;

revoke all on function public.normalize_person_search(text) from public, anon;
grant execute on function public.normalize_person_search(text) to authenticated;
revoke all on function public.search_persons(text, integer) from public, anon;
grant execute on function public.search_persons(text, integer) to authenticated;