-- hire.la — auto-discovered cities & multi-location companies
-- Run in Supabase SQL Editor, then run the worker (it geocodes new places).

-- ============================================================
-- cities: the selector's source of truth. Seeded rows are always
-- listed; auto-discovered rows appear once they have active jobs.
-- ============================================================
create table if not exists cities (
  slug         text primary key,
  name         text not null,
  region       text,
  country      text not null,
  country_code text,
  lng          double precision not null,
  lat          double precision not null,
  zoom         integer not null default 11,
  source       text not null default 'auto' check (source in ('seed', 'auto')),
  created_at   timestamptz not null default now()
);

alter table cities enable row level security;
drop policy if exists "public read cities" on cities;
create policy "public read cities" on cities for select using (true);

insert into cities (slug, name, region, country, country_code, lng, lat, zoom, source) values
  ('los-angeles',   'Los Angeles',   'California',  'United States', 'us', -118.32,  34.00,  9,  'seed'),
  ('san-francisco', 'San Francisco', 'California',  'United States', 'us', -122.42,  37.77,  11, 'seed'),
  ('pune',          'Pune',          'Maharashtra', 'India',         'in',   73.8567, 18.5204, 11, 'seed'),
  ('bengaluru',     'Bengaluru',     'Karnataka',   'India',         'in',   77.5946, 12.9716, 11, 'seed')
on conflict (slug) do nothing;

-- ============================================================
-- locations: how precise is the pin?
--   address — geocoded street address from companies.csv (exact)
--   poi     — company office found in OpenStreetMap (exact-ish)
--   city    — city center placeholder (approximate, shown as such)
-- ============================================================
-- "precision" is a reserved word in PostgreSQL — always quoted.
alter table locations add column if not exists "precision" text not null default 'address'
  check ("precision" in ('address', 'poi', 'city'));
create index if not exists locations_company_city_idx on locations (company_id, city_slug);

-- ============================================================
-- location_aliases: raw ATS location string → city slug, geocoded once.
-- Service-role only (no public policy).
-- ============================================================
create table if not exists location_aliases (
  raw       text primary key,
  city_slug text references cities(slug) on delete set null,
  tried_at  timestamptz not null default now()
);
alter table location_aliases enable row level security;

-- ============================================================
-- cities_with_counts(): selector data — seeded cities always,
-- auto cities only when they have active jobs.
-- ============================================================
create or replace function public.cities_with_counts()
returns table (
  slug text, name text, region text, country text, country_code text,
  lng double precision, lat double precision, zoom integer, jobs bigint
)
language sql
stable
as $$
  select ci.slug, ci.name, ci.region, ci.country, ci.country_code, ci.lng, ci.lat, ci.zoom,
         coalesce(cnt.jobs, 0)
  from cities ci
  left join (
    select l.city_slug, count(j.id) as jobs
    from locations l
    join jobs j on j.location_id = l.id and j.is_active
    group by l.city_slug
  ) cnt on cnt.city_slug = ci.slug
  where ci.source = 'seed' or coalesce(cnt.jobs, 0) > 0
  order by ci.country, ci.name;
$$;
grant execute on function public.cities_with_counts() to anon, authenticated;

-- ============================================================
-- pins_for_city(): now returns precision so approximate pins can
-- be drawn differently.
-- ============================================================
drop function if exists public.pins_for_city(text, text);
create function public.pins_for_city(p_city_slug text, p_category text default null)
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
  group by l.id, c.slug, c.name, c.logo_url, l."precision";
$$;
grant execute on function public.pins_for_city(text, text) to anon, authenticated;
