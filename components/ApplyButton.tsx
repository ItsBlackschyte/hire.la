'use client';

import { useAuth } from './AuthProvider';

interface Props {
  jobId: string;
  applyUrl: string;
  title: string;
  company: string;
  /** 'link' = compact button in job rows; 'cta' = big button on the job page */
  variant?: 'link' | 'cta';
}

/**
 * The Apply button — the one place sign-in is required.
 * Signed in:  opens the company's application in a new tab, records the visit.
 * Signed out: parks the intent and opens the sign-in sheet; AuthProvider
 *             resumes with a "continue to application" bar after OAuth returns.
 * Visited jobs render grey (still clickable) as a memory aid.
 */
export default function ApplyButton({ jobId, applyUrl, title, company, variant = 'link' }: Props) {
  const { user, isVisited, markVisited, requestApply } = useAuth();
  const visited = isVisited(jobId);
  const className = `${variant === 'cta' ? 'apply-cta' : 'apply-link'}${visited ? ' visited' : ''}`;

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!user) {
      e.preventDefault();
      requestApply({ jobId, applyUrl, title, company });
      return;
    }
    markVisited(jobId); // let the default navigation (new tab) proceed
  }

  return (
    <a
      className={className}
      href={applyUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      title={visited ? "You've visited this job" : undefined}
      aria-label={`Apply for ${title} at ${company}${visited ? ' (visited)' : ''}`}
    >
      {variant === 'cta' ? `Apply at ${company}` : 'Apply'}
    </a>
  );
}
