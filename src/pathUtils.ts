import type { QueryInput, QueryParams, RouteParams } from './types';

export interface ParsedUrl {
  pathname: string;
  search: string;
  query: QueryParams;
  hash: string;
}

export interface MatchPathOptions {
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
}

export interface CompiledPattern {
  pattern: string;
  paramNames: string[];
  regex: RegExp;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')) {
    return withLeadingSlash.slice(0, -1);
  }
  return withLeadingSlash;
}

export function normalizeHash(hash?: string | null): string {
  if (!hash) return '';
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

export function parseQueryString(search: string): QueryParams {
  const result: QueryParams = {};
  if (!search) return result;
  const trimmed = search.startsWith('?') ? search.slice(1) : search;
  if (!trimmed) return result;

  const pairs = trimmed.split('&');
  for (const pair of pairs) {
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
    const key = safeDecode(rawKey.replace(/\+/g, ' '));
    const val = safeDecode(rawVal.replace(/\+/g, ' '));

    if (!key) continue;
    const existing = result[key];
    if (existing === undefined) {
      result[key] = val;
    } else if (Array.isArray(existing)) {
      existing.push(val);
    } else {
      result[key] = [existing, val];
    }
  }
  return result;
}

export function normalizeQueryInput(input?: QueryInput | QueryParams): QueryParams {
  const normalized: QueryParams = {};
  if (!input) return normalized;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const items = value
        .filter((item) => item !== undefined && item !== null)
        .map((item) => String(item));
      if (items.length === 1) {
        normalized[key] = items[0];
      } else if (items.length > 1) {
        normalized[key] = items;
      }
    } else {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

export function stringifyQueryParams(query?: QueryInput | QueryParams): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function parseRelativeUrl(url: string): ParsedUrl {
  let working = url || '/';

  // Strip scheme+origin if an absolute URL is ever passed
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(working)) {
    try {
      const parsed = new URL(working);
      // `myapp://myBets/42` parses as host "myBets" + pathname "/42": for custom schemes the
      // host is the first path segment. Web URLs (http/https) keep their real host.
      const isWeb = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      const pathname = !isWeb && parsed.host ? `/${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}` : parsed.pathname;
      working = `${pathname}${parsed.search}${parsed.hash}`;
    } catch {
      // Fall through and treat as relative
    }
  }

  let hash = '';
  const hashIdx = working.indexOf('#');
  if (hashIdx !== -1) {
    hash = working.slice(hashIdx + 1);
    working = working.slice(0, hashIdx);
  }

  let search = '';
  const queryIdx = working.indexOf('?');
  if (queryIdx !== -1) {
    search = working.slice(queryIdx);
    working = working.slice(0, queryIdx);
  }

  const pathname = working ? (working.startsWith('/') ? working : `/${working}`) : '/';
  return {
    pathname,
    search,
    query: parseQueryString(search),
    hash,
  };
}

/** `'#frag'` for a hash with or without its `#`, `''` for none. */
export function formatHash(hash?: string | null): string {
  const clean = normalizeHash(hash);
  return clean ? `#${clean}` : '';
}

/** history v4 location descriptor for a resolved target (`{ pathname, search, hash, state }`). */
export function toLocationDescriptor(target: {
  pathname: string;
  query: QueryInput | QueryParams;
  hash?: string;
  state?: unknown;
}): { pathname: string; search: string; hash: string; state: unknown } {
  return {
    pathname: target.pathname,
    search: stringifyQueryParams(target.query),
    hash: formatHash(target.hash),
    state: target.state,
  };
}

export function formatRelativeUrl(
  pathname: string,
  query?: QueryInput | QueryParams,
  hash?: string,
): string {
  const cleanPathname = pathname ? (pathname.startsWith('/') ? pathname : `/${pathname}`) : '/';
  return `${cleanPathname}${stringifyQueryParams(query)}${formatHash(hash)}`;
}

/** All param names of a pattern (`:id`, `:tab?`, `*`), in order. */
export function extractParamNames(pattern: string): string[] {
  return compileSegments(pattern).paramNames.filter(Boolean);
}

/** Param names a pattern cannot be built without (`:id`, not `:tab?` or `*`). */
export function extractRequiredParamNames(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((segment) => segment.length > 1 && segment.startsWith(':') && !segment.endsWith('?'))
    .map((segment) => segment.slice(1));
}

/** Regex source for a pattern's segments (`/static`, `/:param`, `/:param?`, `/*`) plus its param names. */
function compileSegments(pattern: string): { body: string; paramNames: string[] } {
  const paramNames: string[] = [];
  let body = '';
  const trimmed = pattern.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return { body, paramNames };
  for (const segment of trimmed.split('/')) {
    if (segment === '*') {
      paramNames.push('*');
      body += '(?:/(.*))?';
    } else if (segment.startsWith(':') && segment.endsWith('?')) {
      paramNames.push(segment.slice(1, -1));
      body += '(?:/([^/]+))?';
    } else if (segment.startsWith(':')) {
      paramNames.push(segment.slice(1));
      body += '/([^/]+)';
    } else {
      body += `/${escapeRegex(segment)}`;
    }
  }
  return { body, paramNames };
}

/** End-of-pattern regex: exact (optionally strict about a trailing slash) or prefix match. */
function patternEnd(pattern: string, exact: boolean, strict: boolean): string {
  if (!exact) return '(?=/|$)';
  if (!strict) return '/?$';
  return pattern.endsWith('/') ? '/$' : '$';
}

export function compilePathPattern(
  pattern: string,
  options: MatchPathOptions = {},
): CompiledPattern {
  const { exact = true, strict = false, sensitive = false } = options;
  const flags = sensitive ? '' : 'i';
  if (pattern === '/' || pattern === '') {
    return { pattern, paramNames: [], regex: new RegExp(exact ? (strict ? '^/$' : '^/?$') : '^/', flags) };
  }
  const { body, paramNames } = compileSegments(pattern);
  return { pattern, paramNames, regex: new RegExp(`^${body}${patternEnd(pattern, exact, strict)}`, flags) };
}

/**
 * Compiles a route pattern to match as a segment-aligned suffix of any pathname
 * (for `overlay: true` routes). Capture group 1 is the prefix before the suffix
 * (`""` or `"/prefix/..."`), followed by each pattern param in order.
 */
export function compileOverlaySuffixPattern(
  pattern: string,
  options: MatchPathOptions = {},
): CompiledPattern {
  const { strict = false, sensitive = false } = options;
  const { body, paramNames } = compileSegments(pattern);
  return {
    pattern,
    paramNames,
    regex: new RegExp(`^(.*)${body}${patternEnd(pattern, true, strict)}`, sensitive ? '' : 'i'),
  };
}

/** Joins a base pathname (e.g. "/" or "/projects/42") with an overlay suffix (e.g. "/preview/123"). */
export function joinBaseAndOverlay(basePathname: string, overlaySuffix: string): string {
  const cleanBase = normalizePathname(basePathname);
  const cleanSuffix = overlaySuffix.startsWith('/') ? overlaySuffix : `/${overlaySuffix}`;
  return cleanBase === '/' ? cleanSuffix : `${cleanBase}${cleanSuffix}`;
}

export function matchPathPattern(
  pattern: string,
  pathname: string,
  options: MatchPathOptions = {},
): Record<string, string | undefined> | null {
  const compiled = compilePathPattern(pattern, options);
  const target = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const match = compiled.regex.exec(target);
  if (!match) return null;

  const params: Record<string, string | undefined> = {};
  compiled.paramNames.forEach((name, idx) => {
    const raw = match[idx + 1];
    params[name] = raw === undefined ? undefined : safeDecode(raw);
  });
  return params;
}

export function generatePathFromPattern(
  pattern: string,
  params: RouteParams = {},
  stringify?: Record<string, (value: any) => string>,
): string {
  if (pattern === '/' || pattern === '') return '/';

  const trimmed = pattern.replace(/^\/+|\/+$/g, '');
  const segments = trimmed.split('/');
  const output: string[] = [];

  for (const segment of segments) {
    if (segment === '*') {
      const value = params['*'];
      if (value !== undefined && value !== null && String(value) !== '') {
        const serialized = stringify?.['*'] ? stringify['*'](value) : String(value);
        output.push(
          serialized
            .split('/')
            .map((part) => encodeURIComponent(part))
            .join('/'),
        );
      }
    } else if (segment.startsWith(':') && segment.endsWith('?')) {
      const name = segment.slice(1, -1);
      const value = params[name];
      if (value !== undefined && value !== null && String(value) !== '') {
        const serialized = stringify?.[name] ? stringify[name](value) : String(value);
        output.push(encodeURIComponent(serialized));
      }
    } else if (segment.startsWith(':')) {
      const name = segment.slice(1);
      const value = params[name];
      if (value === undefined || value === null) {
        throw new Error(
          `[react-router-navigation-adapter] Missing required route parameter "${name}" for path pattern "${pattern}".`,
        );
      }
      const serialized = stringify?.[name] ? stringify[name](value) : String(value);
      output.push(encodeURIComponent(serialized));
    } else {
      output.push(segment);
    }
  }

  return output.length === 0 ? '/' : `/${output.join('/')}`;
}
