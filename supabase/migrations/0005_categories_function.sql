-- hire.la — category counts aggregated in SQL
-- Run in Supabase SQL Editor. Replaces counting rows client-side, which was
-- silently capped at PostgREST's 1000-row default.

create or replace function public.categories_for_city(p_city_slug text)
returns table (category text, jobs bigint)
language sql
stable
as $$
  select j.category, count(*)
  from jobs j
  join locations l on l.id = j.location_id
  where l.city_slug = p_city_slug
    and j.is_active
    and j.category is not null
  group by j.category;
$$;

grant execute on function public.categories_for_city(text) to anon, authenticated;
