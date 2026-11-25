import { describe, expect, it } from 'vitest';
import {
  formatRelativeUrl,
  generatePathFromPattern,
  matchPathPattern,
  parseQueryString,
  parseRelativeUrl,
  stringifyQueryParams,
} from '../src/pathUtils';

describe('pathUtils', () => {
  describe('matchPathPattern', () => {
    it('matches static and root paths', () => {
      expect(matchPathPattern('/', '/')).toEqual({});
      expect(matchPathPattern('/', '/users')).toBeNull();
      expect(matchPathPattern('/', '/users', { exact: false })).toEqual({});
      expect(matchPathPattern('/about', '/about')).toEqual({});
      expect(matchPathPattern('/about', '/about/')).toEqual({});
      expect(matchPathPattern('/about', '/about/', { strict: true })).toBeNull();
    });

    it('matches dynamic, optional, and wildcard parameters', () => {
      expect(matchPathPattern('/users/:id', '/users/42')).toEqual({ id: '42' });
      expect(matchPathPattern('/users/:id', '/users/hello%20world')).toEqual({
        id: 'hello world',
      });
      expect(matchPathPattern('/settings/:section?', '/settings')).toEqual({
        section: undefined,
      });
      expect(
        matchPathPattern('/settings/:section?', '/settings/security'),
      ).toEqual({
        section: 'security',
      });
      expect(matchPathPattern('/files/*', '/files/docs/2026/report.pdf')).toEqual(
        {
          '*': 'docs/2026/report.pdf',
        },
      );
    });

    it('respects case sensitivity option', () => {
      expect(matchPathPattern('/Users/:id', '/users/1')).toEqual({ id: '1' });
      expect(
        matchPathPattern('/Users/:id', '/users/1', { sensitive: true }),
      ).toBeNull();
    });
  });

  describe('generatePathFromPattern', () => {
    it('compiles required, optional, and wildcard segments', () => {
      expect(generatePathFromPattern('/', {})).toBe('/');
      expect(generatePathFromPattern('/users/:id', { id: '42' })).toBe(
        '/users/42',
      );
      expect(generatePathFromPattern('/users/:id', { id: 'a b' })).toBe(
        '/users/a%20b',
      );
      expect(generatePathFromPattern('/settings/:section?', {})).toBe(
        '/settings',
      );
      expect(
        generatePathFromPattern('/settings/:section?', { section: 'billing' }),
      ).toBe('/settings/billing');
      expect(
        generatePathFromPattern('/files/*', { '*': 'a/b/c.txt' }),
      ).toBe('/files/a/b/c.txt');
    });

    it('throws when a required param is missing', () => {
      expect(() => generatePathFromPattern('/users/:id', {})).toThrow(
        /Missing required route parameter "id"/,
      );
    });
  });

  describe('query & URL parsing/formatting', () => {
    it('parses and stringifies query parameters including repeated keys', () => {
      expect(parseQueryString('?tab=posts&tag=react&tag=rn&empty=')).toEqual({
        tab: 'posts',
        tag: ['react', 'rn'],
        empty: '',
      });
      expect(
        stringifyQueryParams({
          tab: 'posts',
          page: 2,
          active: true,
          tag: ['react', 'rn'],
          ignored: undefined,
          alsoIgnored: null,
        }),
      ).toBe('?tab=posts&page=2&active=true&tag=react&tag=rn');
    });

    it('parses and formats relative URLs with hash and query', () => {
      expect(parseRelativeUrl('/users/42?tab=posts#bio')).toEqual({
        pathname: '/users/42',
        search: '?tab=posts',
        query: { tab: 'posts' },
        hash: 'bio',
      });
      expect(formatRelativeUrl('/users/42', { tab: 'posts' }, '#bio')).toBe(
        '/users/42?tab=posts#bio',
      );
    });
  });
});
