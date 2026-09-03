-- hire.la — role categories
-- Run in Supabase SQL Editor. Then run the worker once (npm run worker or
-- the GitHub Action) to populate jobs.category for existing rows.

alter table jobs add column if not exists category text;
create index if not exists jobs_category_idx on jobs (category) where is_active;

-- pins_for_city now filters by category instead of raw department.
-- (Postgres can't rename a parameter via CREATE OR REPLACE, so drop first.)
drop function if exists public.pins_for_city(text, text);

create function public.pins_for_city(p_city_slug text, p_category text default null)
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
   and (p_category is null or j.category = p_category)
  where l.city_slug = p_city_slug
  group by l.id, c.slug, c.name;
$$;

grant execute on function public.pins_for_city(text, text) to anon, authenticated;
