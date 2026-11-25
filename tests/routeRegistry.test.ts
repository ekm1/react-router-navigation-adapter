import { describe, expect, it, vi } from 'vitest';
import { defineRoutes } from '../src/routeRegistry';

describe('defineRoutes / RouteRegistry', () => {
  const routes = defineRoutes({
    Home: { path: '/', native: true },
    UserProfile: {
      path: '/users/:id',
      parse: { id: Number },
      stringify: { id: (v: number) => String(v) },
      native: true,
    },
    Settings: { path: '/settings/:section?' },
    Docs: { path: '/docs/*' },
  });

  it('builds URLs from route names, params, query, and hash', () => {
    expect(routes.buildPath('Home')).toBe('/');
    expect(
      routes.buildPath(
        'UserProfile',
        { id: 42 },
        { query: { tab: 'posts' }, hash: 'top' },
      ),
    ).toBe('/users/42?tab=posts#top');
    expect(routes.buildPath('Settings')).toBe('/settings');
    expect(routes.buildPath('Settings', { section: 'notifications' })).toBe(
      '/settings/notifications',
    );
  });

  it('matches URLs and runs param parsers', () => {
    const match = routes.matchUrl('/users/42?tab=likes#summary');
    expect(match).toEqual({
      name: 'UserProfile',
      pattern: '/users/:id',
      pathname: '/users/42',
      path: '/users/42?tab=likes#summary',
      params: { id: 42 },
      query: { tab: 'likes' },
      hash: 'summary',
    });

    expect(routes.matchUrl('/unknown/path')).toBeNull();
  });

  it('resolves all three target formats identically', () => {
    const byName = routes.resolveTarget(
      'UserProfile',
      { id: 7 },
      { query: { tab: 'bio' }, hash: 'header', state: { from: 'home' } },
    );
    const byObject = routes.resolveTarget({
      name: 'UserProfile',
      params: { id: 7 },
      query: { tab: 'bio' },
      hash: '#header',
      state: { from: 'home' },
    });
    const byUrl = routes.resolveTarget('/users/7?tab=bio#header', undefined, {
      state: { from: 'home' },
    });

    expect(byName).toEqual(byObject);
    expect(byUrl).toEqual(byName);
  });

  it('generates a React Navigation linking config', () => {
    const linking = routes.toLinkingConfig(['myapp://', 'https://app.test']);
    expect(linking.prefixes).toEqual(['myapp://', 'https://app.test']);
    expect(linking.config.screens.Home).toMatchObject({ path: '', exact: true });
    expect(linking.config.screens.UserProfile).toMatchObject({
      path: 'users/:id',
      exact: true,
    });
    expect(typeof linking.config.screens.UserProfile.parse?.id).toBe('function');
    // Only `native: true` routes become screens; the rest go through `openWeb`.
    expect(linking.config.screens.Settings).toBeUndefined();
  });

  it('treats params that are not path params as query params', () => {
    expect(routes.buildPath('UserProfile', { id: 7 })).toBe('/users/7');
    const resolved = routes.resolveTarget('UserProfile', { id: 7, type: 'million' }, { query: { page: 2 } });
    expect(resolved.params).toEqual({ id: 7 });
    expect(resolved.query).toEqual({ type: 'million', page: '2' });
    expect(resolved.path).toBe('/users/7?type=million&page=2');
  });

  it('rejects path syntax that would match differently on React Router and React Navigation', () => {
    expect(() => defineRoutes({ A: { path: '/users/:id(\\d+)' } })).toThrow(/unsupported path segment/);
    expect(() => defineRoutes({ A: { path: '/a/:x-:y' } })).toThrow(/unsupported path segment/);
    expect(() => defineRoutes({ A: { path: '/*/x' } })).toThrow(/unsupported path segment/);
  });

  it('warns when a static route is shadowed by an earlier route (first match wins)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shadowed = defineRoutes({
      Ticket: { path: '/myBets/:id' },
      Settled: { path: '/myBets/settled' },
    });
    expect(shadowed.matchUrl('/myBets/settled')?.name).toBe('Ticket');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Settled" (/myBets/settled) is unreachable'));
    warn.mockClear();

    const ordered = defineRoutes({
      Settled: { path: '/myBets/settled' },
      Ticket: { path: '/myBets/:id' },
    });
    expect(ordered.matchUrl('/myBets/settled')?.name).toBe('Settled');
    expect(ordered.matchUrl('/myBets/42')?.name).toBe('Ticket');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
