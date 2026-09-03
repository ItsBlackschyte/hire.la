-- hire.la — allow public read of inactive jobs
-- Run in Supabase SQL Editor.
--
-- Closed positions must stay renderable: /jobs/[slug] shows a
-- "position closed" page instead of a 404, preserving accumulated SEO
-- value. Job postings are public data — nothing sensitive is exposed.
-- The map and panel still show only active jobs (they filter explicitly,
-- and pins_for_city counts only is_active).

drop policy "public read active jobs" on jobs;

create policy "public read jobs"
  on jobs for select
  using (true);
