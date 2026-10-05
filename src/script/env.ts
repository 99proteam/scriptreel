export interface InterpolationResult<T> {
  value: T;
  /** Values that were read from the environment (not defaults). */
  secrets: string[];
  /** Variable names that were referenced but not set and had no default. */
  missing: string[];
}

const PLACEHOLDER = /\$\$\{|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Replace `${NAME}` and `${NAME:-default}` placeholders in a string.
 * `$${NAME}` is an escape and produces a literal `${NAME}`.
 */
export function interpolateString(
  input: string,
  env: Record<string, string | undefined>,
  secrets: Set<string> = new Set(),
  missing: Set<string> = new Set(),
): string {
  return input.replace(PLACEHOLDER, (match, name: string | undefined, fallback: string | undefined) => {
    if (match === '$${') return '${';
    const key = name as string;
    const fromEnv = env[key];
    if (fromEnv !== undefined && fromEnv !== '') {
      secrets.add(fromEnv);
      return fromEnv;
    }
    if (fallback !== undefined) return fallback;
    missing.add(key);
    return '';
  });
}

/** Recursively interpolate every string in a plain JSON-like value. */
export function interpolateEnv<T>(input: T, env: Record<string, string | undefined>): InterpolationResult<T> {
  const secrets = new Set<string>();
  const missing = new Set<string>();
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return interpolateString(value, env, secrets, missing);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  const value = walk(input) as T;
  return { value, secrets: [...secrets], missing: [...missing] };
}

/** Replace every secret value in a string with bullets. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 3) continue;
    out = out.split(secret).join('••••••');
  }
  return out;
}
