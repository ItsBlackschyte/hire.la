/**
 * Maps a raw ATS location string ("Santa Monica, CA", "Remote - US",
 * "Hawthorne, California, United States") onto one of the company's
 * seeded office rows.
 *
 * Strategy, in order:
 *   1. City-name containment — the office whose city appears in the string.
 *   2. HQ fallback — anything unmatched (including remote roles, per the
 *      product decision: remote pins to HQ and carries a badge).
 *
 * `fallback: true` is surfaced in the run summary so mismatched strings
 * are visible instead of silent.
 */

export interface OfficeRow {
  id: string;
  city: string;
  is_hq: boolean;
}

export interface MatchResult {
  locationId: string | null;
  remote: boolean;
  fallback: boolean;
}

export function matchLocation(locationText: string, offices: OfficeRow[]): MatchResult {
  const t = locationText.toLowerCase();
  const remote = t.includes('remote');

  const hit = offices.find((o) => o.city && t.includes(o.city.toLowerCase()));
  if (hit) return { locationId: hit.id, remote, fallback: false };

  const hq = offices.find((o) => o.is_hq) ?? offices[0];
  return { locationId: hq?.id ?? null, remote, fallback: true };
}
