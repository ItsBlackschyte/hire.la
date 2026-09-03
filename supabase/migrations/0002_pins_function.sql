-- hire.la — pins function
-- Run in Supabase SQL Editor (same way as 0001).
--
-- One indexed query returns every office in a city with its company and
-- open-job count (optionally filtered by department). Runs with caller
-- privileges, so RLS still applies — anon callers only ever count
-- jobs where is_active.

create or replace function public.pins_for_city(p_city_slug text, p_department text default null)
returns table (
  location_id  uuid,
  company_slug text,
  company_name text,
  lng          double precision,
  lat          double precision,
  open_jobs    bigint
)
language sql
stable
as $$
  select
    l.id,
    c.slug,
    c.name,
    st_x(l.geom::geometry),
    st_y(l.geom::geometry),
    count(j.id)
  from locations l
  join companies c on c.id = l.company_id
  left join jobs j
    on j.location_id = l.id
   and j.is_active
   and (p_department is null or j.department = p_department)
  where l.city_slug = p_city_slug
  group by l.id, c.slug, c.name;
$$;

grant execute on function public.pins_for_city(text, text) to anon, authenticated;
