import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StaticRouter } from 'react-router-dom';
import { NavigationContainer } from '@react-navigation/native';
import { defineRoutes } from '../src/routeRegistry';
import { useNavigationGuard, useRoute, useRouter } from '../src/hooks';
import { WebRouterProvider } from '../src/adapters/web';
import { NativeRouterProvider } from '../src/adapters/native';
import { RouterView as WebRouterView } from '../src/components/RouterView.web';
import { RouterView as NativeRouterView } from '../src/components/RouterView.native';
import { Link as WebLink } from '../src/components/Link.web';
import { Link as NativeLink } from '../src/components/Link.native';
import { Redirect as WebRedirect } from '../src/components/Redirect.web';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import type { RouterController } from '../src/types';

function Where() {
  return <span data-testid="where">{useRoute().path}</span>;
}

describe('initialUrl with a reused (host) NavigationContainer', () => {
  it('navigates to initialUrl once the screens are mounted', async () => {
    const routes = defineRoutes({
      MyBets: { path: '/myBets', component: () => <span data-testid="screen">MyBets</span>, native: true },
      Ticket: { path: '/myBets/:id', component: () => <Where />, native: true },
    });
    const Stack = createTestStackNavigator();
    render(
      <NavigationContainer>
        <NativeRouterProvider routes={routes} initialUrl="/myBets/42?type=million">
          <NativeRouterView navigator={Stack} />
        </NativeRouterProvider>
      </NavigationContainer>,
    );
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/myBets/42?type=million'));
  });

  it('sends a non-native initialUrl to openWeb', async () => {
    const openWeb = vi.fn();
    const routes = defineRoutes({
      MyBets: { path: '/myBets', component: () => null, native: true },
      Promotions: { path: '/promotions' },
    });
    const Stack = createTestStackNavigator();
    render(
      <NavigationContainer>
        <NativeRouterProvider routes={routes} initialUrl="/promotions" openWeb={openWeb}>
          <NativeRouterView navigator={Stack} />
        </NativeRouterProvider>
      </NavigationContainer>,
    );
    await waitFor(() => expect(openWeb).toHaveBeenCalledWith('/promotions'));
  });
});

describe('Web BrowserRouter: allowed POP after a blocked one goes the right way', () => {
  it('back, then forward, each blocked then proceeded', async () => {
    window.history.replaceState(null, '', '/myBets'); // initial entry has no history key
    let router: RouterController | null = null;
    let pending: (() => void) | null = null;
    let guard = false;
    function Screen() {
      router = useRouter();
      useNavigationGuard(guard, (ctx) => {
        pending = ctx.proceed;
        return false;
      });
      return <Where />;
    }
    const routes = defineRoutes({
      MyBets: { path: '/myBets', component: Screen },
      Ticket: { path: '/myBets/:id', component: Screen },
    });
    const { rerender } = render(
      <WebRouterProvider routes={routes} routerType="browser">
        <WebRouterView />
      </WebRouterProvider>,
    );
    act(() => router!.push('/myBets/1'));
    expect(screen.getByTestId('where')).toHaveTextContent('/myBets/1');

    guard = true;
    rerender(
      <WebRouterProvider routes={routes} routerType="browser">
        <WebRouterView />
      </WebRouterProvider>,
    );

    // Back to the key-less initial entry: blocked, browser is reverted.
    act(() => window.history.back());
    await waitFor(() => expect(pending).not.toBeNull());
    await waitFor(() => expect(window.location.pathname).toBe('/myBets/1'));
    expect(router!.canGoBack()).toBe(true);
    act(() => {
      const p = pending!;
      pending = null;
      p();
    });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/myBets$/));

    // Forward: blocked, then proceeded -> must go forward to /myBets/1, not back.
    act(() => window.history.forward());
    await waitFor(() => expect(pending).not.toBeNull());
    await waitFor(() => expect(window.location.pathname).toBe('/myBets'));
    act(() => pending!());
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/myBets/1'));
    expect(router!.canGoBack()).toBe(true);
    window.history.replaceState(null, '', '/');
  });
});

describe('<Link> forwards refs and extra props', () => {
  const routes = defineRoutes({ MyBets: { path: '/myBets', component: () => null, native: true } });

  it('web: ref is the <a>, HTML/aria props pass through', () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(
      <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/myBets']}>
        <WebLink to="MyBets" ref={ref} id="bets-link" title="My Bets" aria-describedby="hint" data-track="nav">
          Bets
        </WebLink>
      </WebRouterProvider>,
    );
    const anchor = screen.getByText('Bets');
    expect(ref.current).toBe(anchor);
    expect(anchor).toHaveAttribute('id', 'bets-link');
    expect(anchor).toHaveAttribute('title', 'My Bets');
    expect(anchor).toHaveAttribute('aria-describedby', 'hint');
    expect(anchor).toHaveAttribute('data-track', 'nav');
  });

  it('native: ref and Pressable props (hitSlop, onLongPress) pass through', () => {
    const ref = React.createRef<any>();
    const onLongPress = vi.fn();
    function Home() {
      return (
        <NativeLink to="MyBets" ref={ref} hitSlop={8} onLongPress={onLongPress} testID="native-link">
          Bets
        </NativeLink>
      );
    }
    const homeRoutes = defineRoutes({ MyBets: { path: '/myBets', component: Home, native: true } });
    const Stack = createTestStackNavigator();
    render(
      <NativeRouterProvider routes={homeRoutes}>
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );
    const link = screen.getByTestId('native-link');
    expect(link).toHaveAttribute('data-hit-slop', '8');
    expect(ref.current).toBe(link);
    fireEvent.contextMenu(link);
    expect(onLongPress).toHaveBeenCalled();
  });

  it('native: preserves caller accessibilityState when active and inactive', () => {
    function Home() {
      return (
        <>
          <NativeLink to="MyBets" accessibilityState={{ busy: true }} testID="active-busy-link">
            Bets
          </NativeLink>
          <NativeLink to="Other" accessibilityState={{ busy: true }} testID="inactive-busy-link">
            Other
          </NativeLink>
        </>
      );
    }
    const homeRoutes = defineRoutes({
      MyBets: { path: '/myBets', component: Home, native: true },
      Other: { path: '/other', component: () => null, native: true },
    });
    const Stack = createTestStackNavigator();
    render(
      <NativeRouterProvider routes={homeRoutes}>
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );
    expect(screen.getByTestId('active-busy-link')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('active-busy-link')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('inactive-busy-link')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('inactive-busy-link')).not.toHaveAttribute('aria-selected');
  });
});

describe('Web <Redirect> delegates to React Router', () => {
  const routes = defineRoutes({
    Legacy: { path: '/legacy', component: () => <WebRedirect to="Ticket" params={{ id: 1 }} query={{ from: 'legacy' }} /> },
    Ticket: { path: '/myBets/:id', component: () => <Where /> },
  });

  it('redirects during server rendering (StaticRouter context.url)', () => {
    const context: { url?: string } = {};
    renderToString(
      <StaticRouter location="/legacy" context={context}>
        <WebRouterProvider routes={routes}>
          <WebRouterView />
        </WebRouterProvider>
      </StaticRouter>,
    );
    expect(context.url).toBe('/myBets/1?from=legacy');
  });

  it('redirects on the client in the same commit', () => {
    render(
      <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/legacy']}>
        <WebRouterView />
      </WebRouterProvider>,
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/myBets/1?from=legacy');
  });
});
