-- hire.la — office lookup bookkeeping
-- Run in Supabase SQL Editor.

alter table locations add column if not exists lookup_tried_at timestamptz;
alter table locations add column if not exists source text;   -- 'csv' | 'wikidata' | 'website' | 'osm' | 'placeholder'
create index if not exists locations_precision_idx on locations ("precision");
