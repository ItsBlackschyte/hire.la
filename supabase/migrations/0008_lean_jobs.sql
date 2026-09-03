-- hire.la — lean jobs + country scope
-- Run in Supabase SQL Editor.

-- Descriptions are fetched from the ATS at page-render time (cached), never
-- stored: keeps the database ~1 KB/job at any scale.
alter table jobs drop column if exists description_html;

-- Location strings resolved to a city outside the allowed countries are
-- remembered as excluded so they're skipped cheaply on every later run.
alter table location_aliases add column if not exists excluded boolean not null default false;
