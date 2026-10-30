// Layer-name sanitizing. The ORIGINAL name goes on the object; this is for internal ids only.

const MAX_LEN = 50;

export function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const trimmed = cleaned.slice(0, MAX_LEN);
  return trimmed.length > 0 ? trimmed : 'layer';
}

/** De-duplicate with a numeric suffix, keeping the result within MAX_LEN. */
export function uniqueName(name: string, used: Set<string>): string {
  const base = sanitizeName(name);
  let candidate = base;
  for (let n = 2; used.has(candidate); n++) {
    const suffix = `_${n}`;
    candidate = base.slice(0, MAX_LEN - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}
