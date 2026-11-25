import { describe, expect, it } from 'vitest';
import { defineRoutes } from '../src/routeRegistry';

describe('defineRoutes / RouteRegistry', () => {
  const routes = defineRoutes({
    Home: { path: '/' },
    UserProfile: {
      path: '/users/:id',
      parse: { id: Number },
      stringify: { id: (v: number) => String(v) },
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
    expect(linking.config.screens.Settings.path).toBe('settings/:section?');
  });
});
