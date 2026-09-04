-- hire.la — company filter
-- Run in Supabase SQL Editor.

-- Companies with active jobs in a city, for the searchable Company field.
create or replace function public.companies_for_city(p_city_slug text)
returns table (slug text, name text, logo_url text, jobs bigint)
language sql
stable
as $$
  select c.slug, c.name, c.logo_url, count(j.id)
  from companies c
  join locations l on l.company_id = c.id and l.city_slug = p_city_slug
  join jobs j on j.location_id = l.id and j.is_active
  group by c.slug, c.name, c.logo_url
  order by count(j.id) desc, c.name;
$$;
grant execute on function public.companies_for_city(text) to anon, authenticated;

-- pins_for_city gains an optional company filter (existing 2-arg callers still work).
drop function if exists public.pins_for_city(text, text);
create function public.pins_for_city(p_city_slug text, p_category text default null, p_company text default null)
returns table (
  location_id uuid, company_slug text, company_name text, logo_url text,
  "precision" text, lng double precision, lat double precision, open_jobs bigint
)
language sql
stable
as $$
  select l.id, c.slug, c.name, c.logo_url, l."precision",
         st_x(l.geom::geometry), st_y(l.geom::geometry), count(j.id)
  from locations l
  join companies c on c.id = l.company_id
  left join jobs j
    on j.location_id = l.id and j.is_active
   and (p_category is null or j.category = p_category)
  where l.city_slug = p_city_slug
    and (p_company is null or c.slug = p_company)
  group by l.id, c.slug, c.name, c.logo_url, l."precision";
$$;
grant execute on function public.pins_for_city(text, text, text) to anon, authenticated;
