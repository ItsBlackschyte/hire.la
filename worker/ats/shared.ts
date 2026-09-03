/** Helpers shared by all ATS adapters. */

export async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort workplace inference from the location string. */
export function inferWorkplace(locationText: string): 'remote' | 'hybrid' | undefined {
  const t = locationText.toLowerCase();
  if (t.includes('remote')) return 'remote';
  if (t.includes('hybrid')) return 'hybrid';
  return undefined;
}
