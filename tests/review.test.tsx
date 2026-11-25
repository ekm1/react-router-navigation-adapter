import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { StackActions, useNavigation } from '@react-navigation/native';
import { defineRoutes } from '../src/routeRegistry';
import { useNavigationGuard, useRoute, useRouter } from '../src/hooks';
import { WebRouterProvider } from '../src/adapters/web';
import { NativeRouterProvider } from '../src/adapters/native';
import { RouterView as WebRouterView } from '../src/components/RouterView.web';
import { RouterView as NativeRouterView } from '../src/components/RouterView.native';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import { createTestTabNavigator } from './helpers/createTestTabNavigator';
import type { RouterController } from '../src/types';

const captured: { router: RouterController | null; nav: any } = { router: null, nav: null };
afterEach(() => {
  captured.router = null;
  captured.nav = null;
});

const isVisible = (el: Element) => {
  for (let node: Element | null = el.closest('[data-focused]'); node; node = node.parentElement?.closest('[data-focused]') ?? null) {
    if (node.getAttribute('data-focused') !== 'true') return false;
  }
  return true;
};
const focusedPath = () => screen.queryAllByTestId('path').find(isVisible)?.textContent;

function Screen() {
  captured.router = useRouter();
  return <span data-testid="path">{useRoute().path}</span>;
}

describe('guard nextPath for actions React Navigation dispatches (native)', () => {
  const seen: Array<{ action: string; nextPath?: string }> = [];

  function Guarded() {
    captured.nav = useNavigation();
    useNavigationGuard(true, (ctx) => {
      seen.push({ action: ctx.action, nextPath: ctx.nextPath });
      return false;
    });
    return <Screen />;
  }

  const Root = createTestStackNavigator();
  const Tab = createTestTabNavigator();

  const routes = defineRoutes({
    Editor: { path: '/editor', component: Guarded, native: true },
    MyBets: { path: '/myBets', component: Screen, native: true, nestedIn: ['Tabs'] },
    Ticket: { path: '/myBets/:id', component: Screen, native: true, nestedIn: ['Tabs'] },
  });

  function Tabs() {
    return <NativeRouterView navigator={Tab} scope={['Tabs']} />;
  }

  function renderApp() {
    seen.length = 0;
    render(
      <NativeRouterProvider routes={routes} initialUrl="/editor">
        <NativeRouterView navigator={Root} initialRouteName="Editor">
          <Root.Screen name="Tabs" component={Tabs} />
          <Root.Screen name="HostHome" component={() => null} />
        </NativeRouterView>
      </NativeRouterProvider>,
    );
  }

  it('is undefined for a host screen that is not in the registry (no made-up URL)', () => {
    renderApp();
    act(() => captured.nav.dispatch(StackActions.replace('HostHome')));
    expect(seen).toEqual([{ action: 'replace', nextPath: undefined }]);
  });

  it('follows the nested { screen, params } form to the registered screen', () => {
    renderApp();
    act(() =>
      captured.nav.dispatch(
        StackActions.replace('Tabs', { screen: 'Ticket', params: { id: '9', type: 'million' } }),
      ),
    );
    expect(seen).toEqual([{ action: 'replace', nextPath: '/myBets/9?type=million' }]);
  });

  it('follows nested reset state to the focused registered screen', () => {
    renderApp();
    act(() =>
      captured.nav.reset({
        index: 0,
        routes: [{ name: 'Tabs', state: { routes: [{ name: 'Ticket', params: { id: '3' } }] } }],
      }),
    );
    expect(seen).toEqual([{ action: 'reset', nextPath: '/myBets/3' }]);
  });
});

describe.each(['web', 'native'] as const)('reset(targets, index) targets the same entry (%s)', (platform) => {
  const routes = defineRoutes({
    MyBets: { path: '/myBets', component: Screen, native: true },
    Ticket: { path: '/myBets/:id', component: Screen, native: true },
    Promotions: { path: '/promotions', component: Screen }, // web only
  });

  function renderApp(openWeb = vi.fn()) {
    if (platform === 'web') {
      render(
        <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/myBets/1']}>
          <WebRouterView />
        </WebRouterProvider>,
      );
    } else {
      const Stack = createTestStackNavigator();
      render(
        <NativeRouterProvider routes={routes} initialUrl="/myBets/1" openWeb={openWeb}>
          <NativeRouterView navigator={Stack} />
        </NativeRouterProvider>,
      );
    }
    return openWeb;
  }

  const targets = ['MyBets', 'Promotions', { name: 'Ticket', params: { id: '2' } }] as const;

  it('index pointing at a web-only entry lands on it (native: reset, then openWeb)', () => {
    const openWeb = renderApp();
    act(() => captured.router!.reset([...targets], 1));
    if (platform === 'web') {
      expect(focusedPath()).toBe('/promotions');
    } else {
      expect(focusedPath()).toBe('/myBets');
      expect(openWeb).toHaveBeenCalledWith('/promotions');
    }
    expect(captured.router!.getLength()).toBe(platform === 'web' ? 2 : 1);
  });

  it('index after a skipped web-only entry still lands on the indexed entry', () => {
    const openWeb = renderApp();
    act(() => captured.router!.reset([...targets], 2));
    expect(focusedPath()).toBe('/myBets/2');
    expect(openWeb).not.toHaveBeenCalled();
  });

  it('index 0 lands on the first entry', () => {
    renderApp();
    act(() => captured.router!.reset([...targets], 0));
    expect(focusedPath()).toBe('/myBets');
    expect(captured.router!.getLength()).toBe(1);
  });
});
