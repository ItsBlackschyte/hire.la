-- hire.la — initial schema
-- Run this whole file once in Supabase: SQL Editor → New query → paste → Run.

create extension if not exists postgis;

-- ============================================================
-- companies: slow data, seeded once, edited rarely
-- ============================================================
create table companies (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  website     text,
  logo_url    text,
  description text,
  ats_type    text not null check (ats_type in ('greenhouse', 'lever', 'ashby')),
  ats_token   text not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- locations: company offices, geocoded once at seed time
-- ============================================================
create table locations (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label      text,
  address    text,
  city       text not null,
  city_slug  text not null,
  geom       geography(point, 4326) not null,
  is_hq      boolean not null default false
);

create index locations_geom_idx      on locations using gist (geom);
create index locations_city_slug_idx on locations (city_slug);
create index locations_company_idx   on locations (company_id);

-- ============================================================
-- jobs: fast data, owned entirely by the worker
-- ============================================================
create table jobs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  location_id      uuid references locations(id) on delete set null,
  slug             text unique not null,
  source_job_id    text not null,
  title            text not null,
  department       text,
  employment_type  text,
  workplace_type   text check (workplace_type in ('onsite', 'hybrid', 'remote')),
  apply_url        text not null,
  description_html text,
  posted_at        timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  is_active        boolean not null default true,
  unique (company_id, source_job_id)
);

create index jobs_active_idx   on jobs (is_active) where is_active;
create index jobs_location_idx on jobs (location_id);
create index jobs_company_idx  on jobs (company_id);

-- ============================================================
-- Row Level Security: the browser (anon key) may only read.
-- The worker and seed script use the service-role key, which
-- bypasses RLS entirely — no write policies are needed.
-- ============================================================
alter table companies enable row level security;
alter table locations enable row level security;
alter table jobs      enable row level security;

create policy "public read companies"
  on companies for select
  using (true);

create policy "public read locations"
  on locations for select
  using (true);

create policy "public read active jobs"
  on jobs for select
  using (is_active);
