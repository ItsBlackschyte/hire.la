-- hire.la — pins carry the company logo
-- Run in Supabase SQL Editor, then `npm run logos` to fetch logo files.

drop function if exists public.pins_for_city(text, text);

create function public.pins_for_city(p_city_slug text, p_category text default null)
returns table (
  location_id  uuid,
  company_slug text,
  company_name text,
  logo_url     text,
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
    c.logo_url,
    st_x(l.geom::geometry),
    st_y(l.geom::geometry),
    count(j.id)
  from locations l
  join companies c on c.id = l.company_id
  left join jobs j
    on j.location_id = l.id
   and j.is_active
   and (p_category is null or j.category = p_category)
  where l.city_slug = p_city_slug
  group by l.id, c.slug, c.name, c.logo_url;
$$;

grant execute on function public.pins_for_city(text, text) to anon, authenticated;
