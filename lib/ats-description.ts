import { decodeEntities } from './html';

/**
 * Job descriptions are NOT stored — the ATS is the source of truth. The job
 * page fetches the description at render time (server-side, cached by ISR
 * for 6h), so the database stays ~1 KB per job regardless of scale.
 */

const REVALIDATE = 21600;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE }, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchDescription(
  ats: 'greenhouse' | 'lever' | 'ashby',
  token: string,
  sourceJobId: string,
): Promise<string | null> {
  if (ats === 'greenhouse') {
    const j = (await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(sourceJobId)}`,
    )) as { content?: string } | null;
    return j?.content ? decodeEntities(j.content) : null;
  }

  if (ats === 'lever') {
    const j = (await getJson(
      `https://api.lever.co/v0/postings/${encodeURIComponent(token)}/${encodeURIComponent(sourceJobId)}`,
    )) as { description?: string; lists?: Array<{ text?: string; content?: string }>; additional?: string } | null;
    if (!j) return null;
    const parts = [j.description ?? ''];
    for (const l of j.lists ?? []) parts.push(`<h3>${l.text ?? ''}</h3><ul>${l.content ?? ''}</ul>`);
    if (j.additional) parts.push(j.additional);
    const html = parts.join('\n').trim();
    return html || null;
  }

  // Ashby has no single-posting endpoint; the board payload includes descriptions.
  const j = (await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`,
  )) as { jobs?: Array<{ id: string; descriptionHtml?: string }> } | null;
  return j?.jobs?.find((x) => x.id === sourceJobId)?.descriptionHtml ?? null;
}
