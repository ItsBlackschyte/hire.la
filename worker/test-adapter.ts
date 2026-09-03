/**
 * Adapter smoke test — fetches live jobs and prints them. Touches no database.
 *
 *   npm run ats                      # every greenhouse company in companies.csv
 *   npm run ats -- spacex            # one token
 *   npm run ats -- spacex --json     # full normalized JSON for one token
 *
 * This is how you confirm an ATS token is real and see exactly what the
 * worker will ingest in step 11.
 */

import { readFileSync } from 'node:fs';
import { parseCsv } from '../lib/csv';
import { greenhouse } from './ats/greenhouse';
import type { NormalizedJob } from './ats/types';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const explicitToken = args.find((a) => !a.startsWith('--'));

function preview(jobs: NormalizedJob[], limit = 5) {
  for (const j of jobs.slice(0, limit)) {
    const dept = j.department ? ` · ${j.department}` : '';
    const wp = j.workplaceType ? ` [${j.workplaceType}]` : '';
    console.log(`    ${j.title}${dept}`);
    console.log(`      ${j.locationText || '(no location)'}${wp}  id=${j.sourceJobId}`);
  }
  if (jobs.length > limit) console.log(`    … and ${jobs.length - limit} more`);
}

async function runToken(token: string) {
  const jobs = await greenhouse(token);
  if (asJson) {
    console.log(JSON.stringify(jobs, null, 2));
    return jobs.length;
  }
  console.log(`  ${jobs.length} jobs`);
  preview(jobs);
  const withoutLocation = jobs.filter((j) => !j.locationText).length;
  const remote = jobs.filter((j) => j.workplaceType === 'remote').length;
  const departments = new Set(jobs.map((j) => j.department).filter(Boolean));
  console.log(
    `  summary: ${departments.size} departments, ${remote} remote, ${withoutLocation} missing location`,
  );
  return jobs.length;
}

async function main() {
  if (explicitToken) {
    console.log(`\ngreenhouse/${explicitToken}`);
    await runToken(explicitToken);
    return;
  }

  const rows = parseCsv(readFileSync('companies.csv', 'utf8')).filter(
    (r) => r.ats_type === 'greenhouse',
  );
  console.log(`Testing ${rows.length} greenhouse companies from companies.csv\n`);

  let ok = 0;
  let total = 0;
  for (const row of rows) {
    console.log(`${row.name} (${row.ats_token})`);
    try {
      total += await runToken(row.ats_token);
      ok++;
    } catch (err) {
      console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log('');
  }
  console.log(`${ok}/${rows.length} boards reachable, ${total} jobs total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
