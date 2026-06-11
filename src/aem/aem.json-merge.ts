/**
 * Pure helpers for patching a single key→value map that is stored as a
 * JSON-encoded string inside one field. No AEM/network dependencies so the
 * logic stays unit-testable in isolation.
 */

/** Reason codes mirror AEM_ERROR_CODES string literals (kept as plain strings
 *  to avoid coupling this module to the AEM error layer). */
export type JsonMergeErrorCode = 'INVALID_PARAMETERS' | 'VALIDATION_FAILED';

export class JsonMergeError extends Error {
  code: JsonMergeErrorCode;
  constructor(code: JsonMergeErrorCode, message: string) {
    super(message);
    this.name = 'JsonMergeError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decode a single RFC-6901 reference token (~1 → '/', ~0 → '~'). */
function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolve an RFC-6901 JSON Pointer to the live value within `root`.
 * Empty string resolves to `root` itself. Returns the live reference so
 * callers can mutate in place. Throws JsonMergeError if the pointer is
 * malformed or a token does not exist.
 */
export function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) {
    throw new JsonMergeError('INVALID_PARAMETERS', `Invalid JSON pointer "${pointer}": must be empty or start with "/".`);
  }

  const tokens = pointer.split('/').slice(1).map(unescapeToken);
  let current: unknown = root;

  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new JsonMergeError('VALIDATION_FAILED', `JSON pointer "${pointer}" does not resolve: array index "${token}" out of range.`);
      }
      current = current[index];
    } else if (isPlainObject(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        throw new JsonMergeError('VALIDATION_FAILED', `JSON pointer "${pointer}" does not resolve: key "${token}" not found.`);
      }
      current = current[token];
    } else {
      throw new JsonMergeError('VALIDATION_FAILED', `JSON pointer "${pointer}" does not resolve: cannot descend into a non-object at token "${token}".`);
    }
  }

  return current;
}

/**
 * Deep-merge `source` into `target` in place. Plain objects recurse; anything
 * else (scalars, arrays) overwrites. Returns the top-level keys that were added
 * vs. overwritten (for the caller's report).
 */
function deepMergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): { added: string[]; overwritten: string[] } {
  const added: string[] = [];
  const overwritten: string[] = [];

  for (const key of Object.keys(source)) {
    const exists = Object.prototype.hasOwnProperty.call(target, key);
    (exists ? overwritten : added).push(key);

    const incoming = source[key];
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(incoming)) {
      deepMergeInto(existing, incoming);
    } else {
      target[key] = incoming;
    }
  }

  return { added, overwritten };
}

export interface MergeJsonResult {
  result: string;
  added: string[];
  overwritten: string[];
  beforeKeyCount: number;
  afterKeyCount: number;
}

/**
 * Parse `currentValue`, resolve `pointer` to a target object, deep-merge
 * `merge` into it, and re-serialize. `added`/`overwritten`/key counts describe
 * the target object at the pointer.
 */
export function mergeJsonString(
  currentValue: string,
  pointer: string,
  merge: Record<string, unknown>
): MergeJsonResult {
  let root: unknown;
  try {
    root = JSON.parse(currentValue);
  } catch (err: any) {
    throw new JsonMergeError('VALIDATION_FAILED', `Field value is not valid JSON: ${err.message}`);
  }

  const target = resolveJsonPointer(root, pointer);
  if (!isPlainObject(target)) {
    throw new JsonMergeError('VALIDATION_FAILED', `JSON pointer "${pointer}" must resolve to a JSON object, but resolved to ${Array.isArray(target) ? 'an array' : typeof target}.`);
  }

  const beforeKeyCount = Object.keys(target).length;
  const { added, overwritten } = deepMergeInto(target, merge);
  const afterKeyCount = Object.keys(target).length;

  return {
    result: JSON.stringify(root),
    added,
    overwritten,
    beforeKeyCount,
    afterKeyCount,
  };
}
