-- hire.la — accounts (Google sign-in via Supabase Auth)
-- Run in Supabase SQL Editor. Also enable the Google provider:
--   Authentication → Providers → Google (client ID + secret from Google Cloud Console)
--   Authentication → URL Configuration → Site URL + Redirect URLs (see SETUP.md §9)

-- ------------------------------------------------------------ profiles
create table if not exists profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text,
  name                     text,
  avatar_url               text,
  marketing_opt_in         boolean not null default false,
  marketing_opt_in_at      timestamptz,
  marketing_opt_in_source  text,
  created_at               timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "own profile read" on profiles;
drop policy if exists "own profile update" on profiles;
create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);

-- Mirror the auth user into profiles on signup (and refresh name/avatar on later logins).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update
    set email      = excluded.email,
        name       = coalesce(excluded.name, profiles.name),
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);
  return new;
end
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------- saved jobs
create table if not exists saved_jobs (
  user_id  uuid not null references auth.users(id) on delete cascade,
  job_id   uuid not null references jobs(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
alter table saved_jobs enable row level security;
drop policy if exists "own saved read"   on saved_jobs;
drop policy if exists "own saved insert" on saved_jobs;
drop policy if exists "own saved delete" on saved_jobs;
create policy "own saved read"   on saved_jobs for select using (auth.uid() = user_id);
create policy "own saved insert" on saved_jobs for insert with check (auth.uid() = user_id);
create policy "own saved delete" on saved_jobs for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------- job alerts
-- The "Email me new {role} jobs in {city}" checkbox. Sending comes later.
create table if not exists job_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  city_slug  text not null,
  category   text,
  created_at timestamptz not null default now()
);
create unique index if not exists job_alerts_unique on job_alerts (user_id, city_slug, coalesce(category, ''));
alter table job_alerts enable row level security;
drop policy if exists "own alerts read"   on job_alerts;
drop policy if exists "own alerts insert" on job_alerts;
drop policy if exists "own alerts delete" on job_alerts;
create policy "own alerts read"   on job_alerts for select using (auth.uid() = user_id);
create policy "own alerts insert" on job_alerts for insert with check (auth.uid() = user_id);
create policy "own alerts delete" on job_alerts for delete using (auth.uid() = user_id);

-- --------------------------------------------------------------- admins
-- Gate for the admin panel (next). Insert your own user id after first sign-in:
--   insert into admins (user_id) select id from auth.users where email = 'you@example.com';
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table admins enable row level security;
drop policy if exists "admins read own" on admins;
create policy "admins read own" on admins for select using (auth.uid() = user_id);
