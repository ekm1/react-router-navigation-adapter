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
      working = `${parsed.pathname}${parsed.search}${parsed.hash}`;
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

export function formatRelativeUrl(
  pathname: string,
  query?: QueryInput | QueryParams,
  hash?: string,
): string {
  const cleanPathname = pathname ? (pathname.startsWith('/') ? pathname : `/${pathname}`) : '/';
  const search = stringifyQueryParams(query);
  const cleanHash = normalizeHash(hash);
  return `${cleanPathname}${search}${cleanHash ? `#${cleanHash}` : ''}`;
}

export function extractParamNames(pattern: string): string[] {
  const names: string[] = [];
  const clean = pattern.replace(/^\/+|\/+$/g, '');
  if (!clean) return names;

  for (const segment of clean.split('/')) {
    if (segment === '*') {
      names.push('*');
    } else if (segment.startsWith(':')) {
      const name = segment.endsWith('?') ? segment.slice(1, -1) : segment.slice(1);
      if (name) names.push(name);
    }
  }
  return names;
}

export function compilePathPattern(
  pattern: string,
  options: MatchPathOptions = {},
): CompiledPattern {
  const { exact = true, strict = false, sensitive = false } = options;
  const paramNames: string[] = [];

  if (pattern === '/' || pattern === '') {
    const regexStr = exact ? (strict ? '^/$' : '^/?$') : '^/';
    return {
      pattern,
      paramNames,
      regex: new RegExp(regexStr, sensitive ? '' : 'i'),
    };
  }

  const hasTrailingSlash = pattern.endsWith('/');
  const trimmed = pattern.replace(/^\/+|\/+$/g, '');
  const segments = trimmed.split('/');

  let regexBody = '';
  for (const segment of segments) {
    if (segment === '*') {
      paramNames.push('*');
      regexBody += '(?:/(.*))?';
    } else if (segment.startsWith(':') && segment.endsWith('?')) {
      const name = segment.slice(1, -1);
      paramNames.push(name);
      regexBody += '(?:/([^/]+))?';
    } else if (segment.startsWith(':')) {
      const name = segment.slice(1);
      paramNames.push(name);
      regexBody += '/([^/]+)';
    } else {
      regexBody += `/${escapeRegex(segment)}`;
    }
  }

  let suffix: string;
  if (exact) {
    if (strict) {
      suffix = hasTrailingSlash ? '/$' : '$';
    } else {
      suffix = '/?$';
    }
  } else {
    suffix = '(?=/|$)';
  }

  return {
    pattern,
    paramNames,
    regex: new RegExp(`^${regexBody}${suffix}`, sensitive ? '' : 'i'),
  };
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
