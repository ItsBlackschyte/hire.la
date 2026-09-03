/**
 * hire.la fixtures script
 *
 * Inserts ~15 fake jobs spread across the seeded companies so the frontend
 * can be built against realistic data before the worker exists (step 11
 * replaces these with live ATS data and deletes them).
 *
 * Every fixture is marked source_job_id = "fixture-N" so they are trivially
 * identifiable and removable:
 *   delete from jobs where source_job_id like 'fixture-%';
 *
 * Run:  npm run fixtures
 * Idempotent — re-running updates the same rows instead of duplicating.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { jobSlug } from '../lib/slug';

config({ path: '.env.local' });
config();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const TEMPLATES: Array<{ title: string; department: string; workplace: 'onsite' | 'hybrid' | 'remote' }> = [
  { title: 'Software Engineer, Frontend', department: 'Engineering', workplace: 'hybrid' },
  { title: 'Software Engineer, Backend', department: 'Engineering', workplace: 'onsite' },
  { title: 'Senior Full-Stack Engineer', department: 'Engineering', workplace: 'hybrid' },
  { title: 'Machine Learning Engineer', department: 'Engineering', workplace: 'onsite' },
  { title: 'Site Reliability Engineer', department: 'Engineering', workplace: 'remote' },
  { title: 'Product Designer', department: 'Design', workplace: 'hybrid' },
  { title: 'Brand Designer', department: 'Design', workplace: 'onsite' },
  { title: 'Product Manager', department: 'Product', workplace: 'hybrid' },
  { title: 'Senior Product Manager', department: 'Product', workplace: 'onsite' },
  { title: 'Data Analyst', department: 'Data', workplace: 'hybrid' },
  { title: 'Data Engineer', department: 'Data', workplace: 'remote' },
  { title: 'Marketing Manager', department: 'Marketing', workplace: 'onsite' },
  { title: 'Content Strategist', department: 'Marketing', workplace: 'hybrid' },
  { title: 'Recruiter', department: 'People', workplace: 'onsite' },
  { title: 'Customer Success Manager', department: 'Operations', workplace: 'hybrid' },
];

async function main() {
  const { data: locations, error } = await db
    .from('locations')
    .select('id, city, company_id, companies ( id, slug, name, website )')
    .order('id');

  if (error) throw error;
  if (!locations || locations.length === 0) {
    console.error('No locations found — run `npm run seed` first.');
    process.exit(1);
  }

  console.log(`Found ${locations.length} locations. Inserting ${TEMPLATES.length} fixture jobs...\n`);

  let inserted = 0;
  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i];
    const loc = locations[i % locations.length] as unknown as {
      id: string;
      city: string;
      company_id: string;
      companies: { slug: string; name: string; website: string | null };
    };

    const daysAgo = (i * 2) % 21;
    const postedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();

    const { error: jErr } = await db.from('jobs').upsert(
      {
        company_id: loc.company_id,
        location_id: loc.id,
        slug: jobSlug(loc.companies.slug, t.title, loc.city),
        source_job_id: `fixture-${i + 1}`,
        title: t.title,
        department: t.department,
        employment_type: 'Full-time',
        workplace_type: t.workplace,
        apply_url: loc.companies.website ?? 'https://example.com/apply',
        posted_at: postedAt,
        is_active: true,
      },
      { onConflict: 'company_id,source_job_id' },
    );

    if (jErr) {
      console.log(`  FAILED ${t.title} @ ${loc.companies.name}: ${jErr.message}`);
    } else {
      console.log(`  ok  ${t.title.padEnd(32)} @ ${loc.companies.name} (${loc.city}, ${t.workplace})`);
      inserted++;
    }
  }

  console.log(`\nDone: ${inserted}/${TEMPLATES.length} fixture jobs in place.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
