import Link from 'next/link';
import { timeAgo, workplaceLabel } from '@/lib/format';
import type { Job } from '@/lib/types';
import SaveButton from './SaveButton';

/**
 * One job in the panel list. The title links to our own /jobs/[slug]
 * page (the SEO + ad surface); Apply goes straight to the company's
 * real application page in a new tab.
 */
export default function JobRow({ job }: { job: Pick<Job, 'id' | 'slug' | 'title' | 'department' | 'workplace_type' | 'apply_url' | 'posted_at'> }) {
  const posted = timeAgo(job.posted_at);
  const workplace = workplaceLabel(job.workplace_type);

  return (
    <li className="job-row">
      <div className="job-row-main">
        <p className="job-title">
          <Link href={`/jobs/${job.slug}`}>{job.title}</Link>
        </p>
        <p className="job-meta">
          {job.department && <span>{job.department}</span>}
          {workplace && (
            <span className={`badge badge-${job.workplace_type}`}>{workplace}</span>
          )}
          {posted && <span className="job-posted">{posted}</span>}
        </p>
      </div>
      <SaveButton jobId={job.id} />
      <a
        className="apply-link"
        href={job.apply_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Apply for ${job.title} (opens company site)`}
      >
        Apply
      </a>
    </li>
  );
}
