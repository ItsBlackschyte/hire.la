/**
 * The adapter contract. Every ATS integration is one function with this
 * signature — adding ATS #4 to hire.la means adding one file that
 * implements it, nothing else.
 */

export interface NormalizedJob {
  sourceJobId: string;
  title: string;
  department?: string;
  /** Raw location string from the ATS, e.g. "Santa Monica, CA" or "Remote - US". */
  locationText: string;
  applyUrl: string;
  postedAt?: string;
  workplaceType?: 'onsite' | 'hybrid' | 'remote';
  employmentType?: string;
}

export type AtsAdapter = (token: string) => Promise<NormalizedJob[]>;
