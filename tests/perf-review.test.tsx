import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { defineRoutes } from '../src/routeRegistry';
import { useNavigationGuard, useRoute } from '../src/hooks';
import { WebRouterProvider } from '../src/adapters/web';
import { getStateFromUrl, unpackNativeRoute } from '../src/adapters/native';
import { RouterView } from '../src/components/RouterView.web';
import { Link } from '../src/components/Link.web';

describe('PR #4 review: entry guards under overlays', () => {
  const makeRoutes = () =>
    defineRoutes({
      Login: { path: '/login', component: () => <div>login</div>, native: true },
      Admin: {
        path: '/admin',
        component: () => <div>ADMIN SECRET</div>,
        native: true,
        guard: (_route, ctx: any) => (ctx?.authed ? true : 'Login'),
      },
      Preview: { path: '/preview/:id', overlay: true, component: () => <div>preview</div>, native: true },
    });

  it('web: an overlay URL over a guarded base redirects instead of rendering the base', () => {
    const history = createMemoryHistory({ initialEntries: ['/admin/preview/1'] });
    render(
      <WebRouterProvider routes={makeRoutes()} history={history} routeContext={{ authed: false }}>
        <RouterView />
      </WebRouterProvider>,
    );
    expect(screen.queryByText('ADMIN SECRET')).toBeNull();
    expect(history.location.pathname).toBe('/login');
  });

  it('web: the base still renders under the overlay when its guard allows', () => {
    const history = createMemoryHistory({ initialEntries: ['/admin/preview/1'] });
    render(
      <WebRouterProvider routes={makeRoutes()} history={history} routeContext={{ authed: true }}>
        <RouterView />
      </WebRouterProvider>,
    );
    expect(screen.getByText('ADMIN SECRET')).toBeTruthy();
    expect(screen.getByText('preview')).toBeTruthy();
  });

  it('native: a deep link into an overlay over a guarded base resolves to the redirect', () => {
    const routes = makeRoutes();
    const denied = getStateFromUrl(routes, '/admin/preview/1', { authed: false }) as any;
    expect(denied.routes.map((r: any) => r.name)).toEqual(['Login']);
    const allowed = getStateFromUrl(routes, '/admin/preview/1', { authed: true }) as any;
    expect(allowed.routes.map((r: any) => r.name)).toEqual(['Admin', 'Preview']);
  });
});

describe('PR #4 review: entry-guard redirect bypass is not left behind', () => {
  it('a later navigation to the redirect target still runs leave guards', () => {
    const Home = () => {
      useNavigationGuard(true, () => false);
      return <div>home</div>;
    };
    const routes = defineRoutes({
      Home: { path: '/home', component: Home },
      Login: { path: '/login', component: () => <div>login</div> },
      Secret: { path: '/secret', component: () => <div>secret</div>, guard: () => 'Login' },
    });
    const history = createMemoryHistory({ initialEntries: ['/secret'] });
    render(
      <WebRouterProvider routes={routes} history={history}>
        <RouterView />
      </WebRouterProvider>,
    );
    expect(history.location.pathname).toBe('/login');
    act(() => history.push('/home'));
    act(() => history.push('/login'));
    expect(history.location.pathname).toBe('/home');
  });
});

describe('PR #4 review: native matchedPattern', () => {
  it("uses the route's own pattern, not an earlier route that also matches the URL", () => {
    const routes = defineRoutes({
      Catch: { path: '/:section/:tab?', native: true },
      Feed: { path: '/feed/:tab?', native: true },
      Project: { path: ['/projects/:id', '/p/:id/:tab'], native: true },
    });
    expect(unpackNativeRoute({ key: 'k', name: 'Feed', params: { tab: 'x' } } as any, routes).matchedPattern).toBe(
      '/feed/:tab?',
    );
    const project = unpackNativeRoute({ key: 'p', name: 'Project', params: { id: '1', tab: 'a' } } as any, routes);
    expect(project.pathname).toBe('/p/1/a');
    expect(project.matchedPattern).toBe('/p/:id/:tab');
  });
});

describe('PR #4 review: performance', () => {
  it('matches the location once per navigation, however many hooks and links read it', () => {
    const routes = defineRoutes({
      Home: { path: '/', component: () => <Nav /> },
      Item: { path: '/items/:id', component: () => <Nav /> },
    });
    const Nav = () => {
      const route = useRoute();
      return (
        <div>
          <span data-testid="name">{route.name}</span>
          {Array.from({ length: 10 }, (_, i) => (
            <Link key={i} to="Item" params={{ id: String(i) }}>
              item {i}
            </Link>
          ))}
        </div>
      );
    };
    const spy = vi.spyOn(routes, 'matchUrl');
    const history = createMemoryHistory({ initialEntries: ['/'] });
    render(
      <WebRouterProvider routes={routes} history={history}>
        <RouterView />
      </WebRouterProvider>,
    );
    spy.mockClear();
    act(() => history.push('/items/3'));
    expect(screen.getByTestId('name').textContent).toBe('Item');
    // RouterView's own base match + one shared match for all 11 useRoute/useRouter consumers
    // (previously 2 per Link plus 1 for Nav: 23+).
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('an inline, shallow-equal routeContext does not re-match routes on host re-renders', () => {
    const routes = defineRoutes({ Home: { path: '/', component: () => <Probe /> } });
    const Probe = () => {
      useRoute();
      return null;
    };
    const Host = () => {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>tick</button>
          <WebRouterProvider routes={routes} history={history} routeContext={{ authed: true }}>
            <RouterView />
          </WebRouterProvider>
        </>
      );
    };
    const history = createMemoryHistory({ initialEntries: ['/'] });
    render(<Host />);
    const spy = vi.spyOn(routes, 'matchUrl');
    const overlaySpy = vi.spyOn(routes, 'matchOverlayUrl');
    fireEvent.click(screen.getByText('tick'));
    fireEvent.click(screen.getByText('tick'));
    expect(spy).not.toHaveBeenCalled();
    expect(overlaySpy).not.toHaveBeenCalled();
  });
});
