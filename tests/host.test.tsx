import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  NavigationContainer,
  NavigationContainerRefContext,
  getStateFromPath,
} from '@react-navigation/native';
import { Alert, BackHandler } from 'react-native';
import { defineRoutes } from '../src/routeRegistry';
import {
  useNavigationGuard,
  useNavigationListener,
  useParams,
  useQuery,
  useRoute,
  useRouter,
} from '../src/hooks';
import { WebRouterProvider } from '../src/adapters/web';
import { NativeRouterProvider, createLinking } from '../src/adapters/native';
import { RouterView as WebRouterView } from '../src/components/RouterView.web';
import { RouterView as NativeRouterView } from '../src/components/RouterView.native';
import { Link as WebLink } from '../src/components/Link.web';
import { Link as NativeLink } from '../src/components/Link.native';
import { withRouter as webWithRouter } from 'react-router-dom';
import { withRouter as nativeWithRouter } from '../src/compat.native';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import type { BackAtRootContext, GetUserConfirmation, HistoryAction } from '../src/types';

const mounts: Record<string, number> = {};
afterEach(() => {
  for (const key of Object.keys(mounts)) delete mounts[key];
  (Alert as any).respond = 'Cancel';
});

/** Counts real mounts (not re-renders) per component name. */
function useMountCount(name: string) {
  React.useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type Platform = 'web' | 'native';

interface AppOptions {
  initialUrl: string;
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  getUserConfirmation?: GetUserConfirmation;
  openWeb?: (url: string) => void;
  guard?: string | false;
}

function createApp(platform: Platform) {
  const Link = platform === 'web' ? WebLink : NativeLink;
  const withRouter: any = platform === 'web' ? webWithRouter : nativeWithRouter;
  const events: Array<[string, HistoryAction]> = [];
  let guardMessage: string | false = false;

  function MyBetsList() {
    const router = useRouter();
    useMountCount('MyBets');
    return (
      <div data-testid="screen-mybets">
        <button data-testid="open-1" onClick={() => router.navigate('Ticket', { id: '1' })} />
        <button data-testid="open-promotions" onClick={() => router.navigate('Promotions')} />
      </div>
    );
  }

  function Settled() {
    return <div data-testid="screen-settled" />;
  }

  // A React Router v5 style container, unchanged: withRouter + history.replace({ search }).
  const TicketFilters = withRouter(({ history, location, match }: any) => (
    <div>
      <span data-testid="compat-search">{location.search}</span>
      <span data-testid="compat-match">{JSON.stringify(match.params)}</span>
      <span data-testid="compat-action">{history.action}</span>
      <button data-testid="compat-replace" onClick={() => history.replace({ search: '?type=million' })} />
    </div>
  ));

  function Ticket() {
    const router = useRouter();
    const route = useRoute();
    const { id } = useParams<{ id: string }>();
    const query = useQuery();
    useMountCount('Ticket');
    useNavigationGuard(Boolean(guardMessage), guardMessage || undefined);
    return (
      <div data-testid="screen-ticket">
        <span data-testid="ticket-id">{id}</span>
        <span data-testid="ticket-query">{JSON.stringify(query)}</span>
        <span data-testid="ticket-path">{route.path}</span>
        <span data-testid="can-go-back">{String(router.canGoBack())}</span>
        <button data-testid="next-ticket" onClick={() => router.navigate('Ticket', { id: String(Number(id) + 1) })} />
        <button data-testid="same-ticket" onClick={() => router.navigate(route.path)} />
        <button data-testid="back" onClick={() => router.goBack()} />
        <button data-testid="set-query" onClick={() => router.setQuery({ type: 'single' })} />
        <button data-testid="reset" onClick={() => router.reset(['MyBets'])} />
        <button data-testid="extra-params" onClick={() => router.navigate('Ticket', { id: '9', type: 'acca' })} />
        <Link to="MyBets" activeClassName="active" activeStyle={{ fontWeight: 'bold' }} testID="nav-mybets">
          My Bets
        </Link>
        <Link to="MyBets" exact activeClassName="active" activeStyle={{ fontWeight: 'bold' }} testID="nav-mybets-exact">
          My Bets (exact)
        </Link>
        <TicketFilters />
      </div>
    );
  }

  function Analytics() {
    useNavigationListener((route, action) => {
      events.push([route.path, action]);
    });
    return null;
  }

  const routes = defineRoutes({
    MyBets: { path: '/myBets', component: MyBetsList, native: true },
    Settled: { path: '/myBets/settled', component: Settled, native: true },
    Ticket: { path: '/myBets/:id', component: Ticket, native: true, parent: 'MyBets' },
    Promotions: { path: '/promotions' },
  });

  const renderApp = (options: AppOptions) => {
    guardMessage = options.guard ?? false;
    if (platform === 'web') {
      return render(
        <WebRouterProvider
          routes={routes}
          routerType="memory"
          initialEntries={[options.initialUrl]}
          onBackAtRoot={options.onBackAtRoot}
          getUserConfirmation={options.getUserConfirmation}
        >
          <Analytics />
          <WebRouterView />
        </WebRouterProvider>,
      );
    }
    const Stack = createTestStackNavigator();
    return render(
      <NativeRouterProvider
        routes={routes}
        initialUrl={options.initialUrl}
        onBackAtRoot={options.onBackAtRoot}
        getUserConfirmation={options.getUserConfirmation}
        openWeb={options.openWeb}
      >
        <Analytics />
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );
  };

  return { routes, renderApp, events };
}

const visible = (testId: string) => {
  const all = screen.queryAllByTestId(testId);
  return all.find((el) => (el.closest('[data-focused]')?.getAttribute('data-focused') ?? 'true') === 'true');
};
const text = (testId: string) => visible(testId)?.textContent;
const click = (testId: string) => fireEvent.click(visible(testId)!);

describe.each<Platform>(['web', 'native'])('My Bets host scenarios (%s)', (platform) => {
  it('opened from a path: query params are query, not path params', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets/42?type=million' });
    expect(text('ticket-id')).toBe('42');
    expect(text('ticket-query')).toBe('{"type":"million"}');
    expect(text('ticket-path')).toBe('/myBets/42?type=million');
  });

  it('matches static routes declared before dynamic ones', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets/settled' });
    expect(visible('screen-settled')).toBeTruthy();
  });

  it('navigate to another ticket adds a history entry; back returns to the first', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets' });
    click('open-1');
    expect(text('ticket-id')).toBe('1');
    click('next-ticket');
    expect(text('ticket-id')).toBe('2');
    expect(text('can-go-back')).toBe('true');
    click('back');
    expect(text('ticket-id')).toBe('1');
  });

  it('navigate to the current location does not add an entry', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets/5?type=million' });
    click('same-ticket');
    expect(text('ticket-id')).toBe('5');
    expect(text('can-go-back')).toBe('false');
  });

  it('extra params become query params', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets' });
    click('open-1');
    click('extra-params');
    expect(text('ticket-id')).toBe('9');
    expect(text('ticket-query')).toBe('{"type":"acca"}');
    expect(text('ticket-path')).toBe('/myBets/9?type=acca');
  });

  it('goBack at the root calls onBackAtRoot (e.g. close the host)', () => {
    const onBackAtRoot = vi.fn();
    createApp(platform).renderApp({ initialUrl: '/myBets/42', onBackAtRoot });
    click('back');
    expect(onBackAtRoot).toHaveBeenCalledTimes(1);
    expect(onBackAtRoot.mock.calls[0][0].route.path).toBe('/myBets/42');
    expect(typeof onBackAtRoot.mock.calls[0][0].router.replace).toBe('function');
  });

  it('goBack at the root falls back to the route parent', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets/42' });
    click('back');
    expect(visible('screen-mybets')).toBeTruthy();
  });

  it('string guard asks for confirmation: cancel stays, confirm leaves', () => {
    const answers: boolean[] = [false, true];
    const getUserConfirmation = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift()!));
    createApp(platform).renderApp({ initialUrl: '/myBets', guard: 'Discard bet slip?', getUserConfirmation });
    click('open-1');
    click('back');
    expect(getUserConfirmation).toHaveBeenCalledWith('Discard bet slip?', expect.any(Function));
    expect(text('ticket-id')).toBe('1');
    click('back');
    expect(visible('screen-mybets')).toBeTruthy();
  });

  it('reset() goes through the guard', () => {
    const getUserConfirmation = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
    createApp(platform).renderApp({ initialUrl: '/myBets', guard: 'Discard?', getUserConfirmation });
    click('open-1');
    click('reset');
    expect(getUserConfirmation).toHaveBeenCalledTimes(1);
    expect(text('ticket-id')).toBe('1');
  });

  it('query-only updates are not blocked by the guard and keep the screen mounted', () => {
    const getUserConfirmation = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
    createApp(platform).renderApp({ initialUrl: '/myBets/42', guard: 'Discard?', getUserConfirmation });
    const mountsBefore = Object.values(mounts).reduce((a, b) => a + b, 0);
    click('set-query');
    expect(text('ticket-query')).toBe('{"type":"single"}');
    expect(getUserConfirmation).not.toHaveBeenCalled();
    expect(Object.values(mounts).reduce((a, b) => a + b, 0)).toBe(mountsBefore);
  });

  it('withRouter + history.replace({ search }) works unchanged', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets/42' });
    expect(text('compat-match')).toBe('{"id":"42"}');
    const mountsBefore = Object.values(mounts).reduce((a, b) => a + b, 0);
    click('compat-replace');
    expect(text('compat-search')).toBe('?type=million');
    expect(text('ticket-query')).toBe('{"type":"million"}');
    expect(text('compat-action')).toBe('REPLACE');
    expect(Object.values(mounts).reduce((a, b) => a + b, 0)).toBe(mountsBefore);
  });

  it('location listener reports path and action, outside screens', () => {
    const { renderApp, events } = createApp(platform);
    renderApp({ initialUrl: '/myBets' });
    click('open-1');
    click('next-ticket');
    click('back');
    expect(events).toEqual([
      ['/myBets/1', 'PUSH'],
      ['/myBets/2', 'PUSH'],
      ['/myBets/1', 'POP'],
    ]);
  });

  it('Link shows NavLink-style active state', () => {
    createApp(platform).renderApp({ initialUrl: '/myBets/42' });
    const prefix = visible('nav-mybets')!;
    const exact = visible('nav-mybets-exact')!;
    if (platform === 'web') {
      expect(prefix).toHaveClass('active');
      expect(prefix).toHaveAttribute('aria-current', 'page');
      expect(exact).not.toHaveClass('active');
    } else {
      expect(prefix).toHaveAttribute('aria-selected', 'true');
      expect(prefix).toHaveStyle({ fontWeight: 'bold' });
      expect(exact).not.toHaveAttribute('aria-selected');
    }
  });
});

describe('Native only', () => {
  it('guard sets preventNativeDismiss, so native-stack blocks iOS swipe-back', () => {
    createApp('native').renderApp({ initialUrl: '/myBets/42', guard: 'Discard?' });
    expect(screen.getByTestId('rn-screen-Ticket')).toHaveAttribute('data-prevent-native-dismiss', 'true');
  });

  it('Android hardware back: defers to React Navigation while it can go back, onBackAtRoot at the root', () => {
    const onBackAtRoot = vi.fn();
    createApp('native').renderApp({ initialUrl: '/myBets', onBackAtRoot });
    click('open-1');
    // React Navigation's own handler (useBackButton.native) pops here; tests load its web no-op build.
    let handled = true;
    act(() => {
      handled = (BackHandler as any).pressBack();
    });
    expect(handled).toBe(false);
    expect(onBackAtRoot).not.toHaveBeenCalled();
    click('back');
    act(() => {
      handled = (BackHandler as any).pressBack();
    });
    expect(handled).toBe(true);
    expect(onBackAtRoot).toHaveBeenCalledTimes(1);
  });

  it('Android hardware back at the root falls back to the route parent', () => {
    createApp('native').renderApp({ initialUrl: '/myBets/42' });
    act(() => {
      (BackHandler as any).pressBack();
    });
    expect(visible('screen-mybets')).toBeTruthy();
  });

  it('default confirmation uses Alert.alert', () => {
    const alert = vi.spyOn(Alert, 'alert');
    createApp('native').renderApp({ initialUrl: '/myBets', guard: 'Discard?' });
    click('open-1');
    click('back');
    expect(alert).toHaveBeenCalledWith('Discard?', undefined, expect.any(Array), expect.any(Object));
    expect(text('ticket-id')).toBe('1');
    (Alert as any).respond = 'Leave';
    click('back');
    expect(visible('screen-mybets')).toBeTruthy();
    alert.mockRestore();
  });

  it('WebView boundary: non-native routes and unknown URLs go to openWeb', () => {
    const openWeb = vi.fn();
    const { renderApp } = createApp('native');
    renderApp({ initialUrl: '/myBets', openWeb });
    click('open-promotions');
    expect(openWeb).toHaveBeenCalledWith('/promotions');
    expect(visible('screen-mybets')).toBeTruthy();
  });

  it('WebView boundary: opening the host at a non-native URL calls openWeb', () => {
    const openWeb = vi.fn();
    createApp('native').renderApp({ initialUrl: '/promotions?x=1', openWeb });
    expect(openWeb).toHaveBeenCalledWith('/promotions?x=1');
  });

  it('WebView boundary: a native route that has no mounted screen goes to openWeb', () => {
    const openWeb = vi.fn();
    let router: ReturnType<typeof useRouter> | null = null;
    function Home() {
      router = useRouter();
      return null;
    }
    const routes = defineRoutes({
      Home: { path: '/', component: Home, native: true },
      Orphan: { path: '/orphan', native: true }, // flagged native but no screen rendered
    });
    const Stack = createTestStackNavigator();
    render(
      <NativeRouterProvider routes={routes} openWeb={openWeb}>
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );
    act(() => router!.navigate('/orphan?x=1'));
    expect(openWeb).toHaveBeenCalledWith('/orphan?x=1');
    act(() => router!.navigate('/not/registered'));
    expect(openWeb).toHaveBeenCalledWith('/not/registered');
  });

  it('host linking config with flat query params (React Navigation default parser)', () => {
    const { routes } = createApp('native');
    const host = routes.toLinkingConfig(['myapp://']).config;
    const initialState = getStateFromPath('myBets/42?type=million', host as any);
    expect(initialState?.routes[0].params).toEqual({ id: '42', type: 'million' }); // the problem input
    const Stack = createTestStackNavigator();
    render(
      <NativeRouterProvider routes={routes} initialState={initialState as any}>
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );
    expect(text('ticket-id')).toBe('42');
    expect(text('ticket-query')).toBe('{"type":"million"}');
    click('set-query');
    expect(text('ticket-query')).toBe('{"type":"single"}');
  });

  it('generated linking parses query and hash and never leaks adapter metadata', () => {
    const { routes } = createApp('native');
    const linking = createLinking(routes, ['myapp://']);
    const state = linking.getStateFromPath!('myBets/42?type=million#legs', linking.config as any);
    expect(state?.routes[0]).toMatchObject({ name: 'Ticket', params: { id: '42' } });
    const path = linking.getPathFromState!(state as any, linking.config as any);
    expect(path).toBe('/myBets/42?type=million#legs');
    expect(path).not.toContain('__urMeta');
  });

  it('reuses an existing NavigationContainer and navigates from outside screens', () => {
    const { routes } = createApp('native');
    let outside: ReturnType<typeof useRouter> | null = null;
    function OutsideScreens() {
      outside = useRouter();
      const route = useRoute();
      return <span data-testid="outside-route">{route.path}</span>;
    }
    const Stack = createTestStackNavigator();
    render(
      <NavigationContainer>
        <NativeRouterProvider routes={routes}>
          <OutsideScreens />
          <NativeRouterView navigator={Stack} />
        </NativeRouterProvider>
      </NavigationContainer>,
    );
    expect(screen.getByTestId('outside-route')).toHaveTextContent('/myBets');
    act(() => outside!.navigate('/myBets/7?type=million'));
    expect(text('ticket-id')).toBe('7');
    expect(screen.getByTestId('outside-route')).toHaveTextContent('/myBets/7?type=million');
  });

  it('independent mounts its own tree inside an existing container', () => {
    const { routes } = createApp('native');
    const Stack = createTestStackNavigator();
    let innerRef: unknown;
    function Probe() {
      innerRef = React.useContext(NavigationContainerRefContext);
      return null;
    }
    render(
      <NavigationContainer>
        <NativeRouterProvider routes={routes} independent initialUrl="/myBets/3">
          <Probe />
          <NativeRouterView navigator={Stack} />
        </NativeRouterProvider>
      </NavigationContainer>,
    );
    expect(innerRef).toBeTruthy();
    expect(text('ticket-id')).toBe('3');
  });

  it('throws a clear error when a non-native target has no openWeb', () => {
    let router: ReturnType<typeof useRouter> | null = null;
    function Home() {
      router = useRouter();
      return null;
    }
    const routes = defineRoutes({
      Home: { path: '/', component: Home, native: true },
      Promotions: { path: '/promotions' },
    });
    const Stack = createTestStackNavigator();
    render(
      <NativeRouterProvider routes={routes}>
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );
    expect(() => router!.navigate('Promotions')).toThrow(/"\/promotions" has no native screen/);
  });
});

describe('Web only', () => {
  it('Link href includes the router basename', () => {
    window.history.replaceState({}, '', '/app/myBets/42');
    const { routes } = createApp('web');
    render(
      <WebRouterProvider routes={routes} routerType="browser" basename="/app">
        <WebRouterView />
      </WebRouterProvider>,
    );
    expect(visible('nav-mybets')).toHaveAttribute('href', '/app/myBets');
    window.history.replaceState({}, '', '/');
  });

  it('string guard uses the provider confirmation inside an existing MemoryRouter', () => {
    const getUserConfirmation = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
    const { routes } = createApp('web');
    function Guarded() {
      useNavigationGuard(true, 'Discard?');
      const router = useRouter();
      return <button data-testid="leave" onClick={() => router.navigate('MyBets')} />;
    }
    render(
      <MemoryRouter initialEntries={['/myBets/1']}>
        <WebRouterProvider routes={routes} getUserConfirmation={getUserConfirmation}>
          <Guarded />
          <span data-testid="where">
            <WhereAmI />
          </span>
        </WebRouterProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('leave'));
    expect(getUserConfirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/myBets/1');
  });

  it('async proceed() keeps the guard active afterwards', () => {
    let pending: (() => void) | null = null;
    const { routes } = createApp('web');
    function Guarded() {
      useNavigationGuard(true, (ctx) => {
        pending = ctx.proceed;
        return false;
      });
      const router = useRouter();
      return (
        <>
          <button data-testid="go-1" onClick={() => router.navigate('/myBets/1')} />
          <button data-testid="go-2" onClick={() => router.navigate('/myBets/2')} />
        </>
      );
    }
    render(
      <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/myBets']}>
        <Guarded />
        <span data-testid="where">
          <WhereAmI />
        </span>
      </WebRouterProvider>,
    );
    fireEvent.click(screen.getByTestId('go-1'));
    expect(screen.getByTestId('where')).toHaveTextContent('/myBets');
    act(() => pending!());
    expect(screen.getByTestId('where')).toHaveTextContent('/myBets/1');
    pending = null;
    fireEvent.click(screen.getByTestId('go-2'));
    expect(pending).not.toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/myBets/1');
  });
});

function WhereAmI() {
  return <>{useRoute().path}</>;
}
