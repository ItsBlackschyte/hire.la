/** True when the browser can create a WebGL context (needed by MapLibre). Client-only. */
export function webglAvailable(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
