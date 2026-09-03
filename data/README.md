# data/boards.json

~1,800 public job boards (Greenhouse / Lever / Ashby) with the token and company
name, harvested from real application URLs in public job-listing repositories
(SimplifyJobs New-Grad / Internship trackers). Used by `npm run discover` to
match companies to their boards without guessing. Refresh by re-running the
harvest (see scripts/discover.ts header) — tokens occasionally change.
