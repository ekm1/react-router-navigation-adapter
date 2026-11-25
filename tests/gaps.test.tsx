import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BackHandler } from 'react-native';
import { defineRoutes } from '../src/routeRegistry';
import { useNavigationGuard, useQuery, useRoute, useRouter } from '../src/hooks';
import { WebRouterProvider } from '../src/adapters/web';
import { NativeRouterProvider, createLinking } from '../src/adapters/native';
import { RouterView as WebRouterView } from '../src/components/RouterView.web';
import { RouterView as NativeRouterView } from '../src/components/RouterView.native';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import { createTestTabNavigator } from './helpers/createTestTabNavigator';
import type { GetUserConfirmation, RouterController } from '../src/types';

type Platform = 'web' | 'native';

/** Captures the router of whichever screen rendered last, plus a layout-level one. */
const captured: { screen: RouterController | null; layout: RouterController | null } = {
  screen: null,
  layout: null,
};
afterEach(() => {
  captured.screen = null;
  captured.layout = null;
});

function Screen({ name }: { name: string }) {
  const router = useRouter();
  const route = useRoute();
  const query = useQuery();
  captured.screen = router;
  return (
    <div data-testid={`screen-${name}`}>
      <span data-testid="path">{route.path}</span>
      <span data-testid="query">{JSON.stringify(query)}</span>
    </div>
  );
}

let guardWhen = false;
function GuardedTicket() {
  useNavigationGuard(guardWhen, 'Discard?');
  return <Screen name="Ticket" />;
}

function Layout({ guard }: { guard?: boolean }) {
  captured.layout = useRouter();
  useNavigationGuard(Boolean(guard), 'Leave the app section?');
  return null;
}

const routes = defineRoutes({
  MyBets: { path: '/myBets', component: () => <Screen name="MyBets" />, native: true },
  Ticket: { path: '/myBets/:id', component: GuardedTicket, native: true, parent: 'MyBets' },
  Bets: { path: '/bets', component: () => <Screen name="Bets" />, native: true, exact: false },
  Promotions: { path: '/promotions', component: () => <Screen name="Promotions" /> },
});

interface Options {
  initialUrl: string;
  guard?: boolean;
  layoutGuard?: boolean;
  confirm?: GetUserConfirmation;
  onBackAtRoot?: () => void;
  openWeb?: (url: string) => void;
}

function renderApp(platform: Platform, options: Options) {
  guardWhen = Boolean(options.guard);
  if (platform === 'web') {
    return render(
      <WebRouterProvider
        routes={routes}
        routerType="memory"
        initialEntries={[options.initialUrl]}
        getUserConfirmation={options.confirm}
        onBackAtRoot={options.onBackAtRoot}
      >
        <Layout guard={options.layoutGuard} />
        <WebRouterView fallback={() => <Screen name="web-only" />} />
      </WebRouterProvider>,
    );
  }
  const Stack = createTestStackNavigator();
  return render(
    <NativeRouterProvider
      routes={routes}
      initialUrl={options.initialUrl}
      getUserConfirmation={options.confirm}
      onBackAtRoot={options.onBackAtRoot}
      openWeb={options.openWeb ?? (() => {})}
    >
      <Layout guard={options.layoutGuard} />
      <NativeRouterView navigator={Stack} />
    </NativeRouterProvider>,
  );
}

/** Visible means every enclosing navigator wrapper is focused (nested navigators). */
const isVisible = (el: Element) => {
  for (let node: Element | null = el.closest('[data-focused]'); node; node = node.parentElement?.closest('[data-focused]') ?? null) {
    if (node.getAttribute('data-focused') !== 'true') return false;
  }
  return true;
};
const focusedText = (testId: string) => screen.queryAllByTestId(testId).find(isVisible)?.textContent;
const focusedPath = () => focusedText('path');
const focusedQuery = () => focusedText('query');
const declineThenAccept = () => {
  const answers = [false, true];
  return vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? true));
};

describe.each<Platform>(['web', 'native'])('B1 guards are never bypassed (%s)', (platform) => {
  it('guards run before leaving for a non-native (web-only) URL', () => {
    const confirm = declineThenAccept();
    const openWeb = vi.fn();
    renderApp(platform, { initialUrl: '/myBets/1', guard: true, confirm, openWeb });
    act(() => captured.screen!.navigate('/promotions'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(openWeb).not.toHaveBeenCalled();
    expect(focusedPath()).toBe('/myBets/1');
    act(() => captured.screen!.navigate('/promotions'));
    if (platform === 'native') expect(openWeb).toHaveBeenCalledWith('/promotions');
    else expect(focusedPath()).toBe('/promotions');
  });

  it('guards run before onBackAtRoot', () => {
    const confirm = declineThenAccept();
    const onBackAtRoot = vi.fn();
    renderApp(platform, { initialUrl: '/myBets/1', guard: true, confirm, onBackAtRoot });
    act(() => captured.screen!.goBack());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onBackAtRoot).not.toHaveBeenCalled();
    act(() => captured.screen!.goBack());
    expect(onBackAtRoot).toHaveBeenCalledTimes(1);
  });

  it('guards run for same-route replace that changes the pathname', () => {
    const confirm = declineThenAccept();
    renderApp(platform, { initialUrl: '/myBets/1', guard: true, confirm });
    act(() => captured.screen!.replace('Ticket', { id: '2' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(focusedPath()).toBe('/myBets/1');
    act(() => captured.screen!.replace('Ticket', { id: '2' }));
    expect(focusedPath()).toBe('/myBets/2');
  });

  it('guards run for setParams that changes the pathname', () => {
    const confirm = declineThenAccept();
    renderApp(platform, { initialUrl: '/myBets/1', guard: true, confirm });
    act(() => captured.screen!.setParams({ id: '2' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(focusedPath()).toBe('/myBets/1');
    act(() => captured.screen!.setParams({ id: '2' }));
    expect(focusedPath()).toBe('/myBets/2');
  });

  it('guards mounted outside screens (layout/shell) block navigation', () => {
    const confirm = declineThenAccept();
    renderApp(platform, { initialUrl: '/myBets', layoutGuard: true, confirm });
    act(() => captured.screen!.navigate('Ticket', { id: '5' }));
    expect(confirm).toHaveBeenCalledWith('Leave the app section?', expect.any(Function));
    expect(focusedPath()).toBe('/myBets');
    act(() => captured.screen!.navigate('Ticket', { id: '5' }));
    expect(focusedPath()).toBe('/myBets/5');
  });

  it('pushing away from a guarded screen is blocked, like web', () => {
    const confirm = declineThenAccept();
    renderApp(platform, { initialUrl: '/myBets/1', guard: true, confirm });
    act(() => captured.screen!.navigate('Ticket', { id: '2' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(focusedPath()).toBe('/myBets/1');
  });

  it('query-only changes still pass', () => {
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
    renderApp(platform, { initialUrl: '/myBets/1', guard: true, layoutGuard: true, confirm });
    act(() => captured.screen!.setQuery({ type: 'acca' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(focusedQuery()).toBe('{"type":"acca"}');
  });
});

describe('B1 native: Android back at the root runs guards', () => {
  it('declines, then accepts', () => {
    const confirm = declineThenAccept();
    const onBackAtRoot = vi.fn();
    renderApp('native', { initialUrl: '/myBets/1', guard: true, confirm, onBackAtRoot });
    act(() => {
      expect((BackHandler as any).pressBack()).toBe(true);
    });
    expect(onBackAtRoot).not.toHaveBeenCalled();
    act(() => {
      (BackHandler as any).pressBack();
    });
    expect(onBackAtRoot).toHaveBeenCalledTimes(1);
  });

  it('layout guards run for Android back that React Navigation would otherwise handle', () => {
    const answers = [true, false];
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? false));
    renderApp('native', { initialUrl: '/myBets', layoutGuard: true, confirm });
    act(() => captured.screen!.navigate('Ticket', { id: '5' }));
    expect(focusedPath()).toBe('/myBets/5');
    let handled = false;
    act(() => {
      handled = (BackHandler as any).pressBack();
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(handled).toBe(true); // consumed: React Navigation must not pop
    expect(focusedPath()).toBe('/myBets/5');
  });
});

describe.each<Platform>(['web', 'native'])('B2 custom-scheme URLs keep the first segment (%s)', (platform) => {
  it('navigates to myapp://myBets/42?type=million', () => {
    renderApp(platform, { initialUrl: '/myBets' });
    act(() => captured.screen!.navigate('myapp://myBets/42?type=million'));
    expect(focusedPath()).toBe('/myBets/42?type=million');
  });
});

describe.each<Platform>(['web', 'native'])('B4 setParams keeps query in sync (%s)', (platform) => {
  it('updates a query key that already exists', () => {
    renderApp(platform, { initialUrl: '/myBets/42?type=million' });
    act(() => captured.screen!.setParams({ type: 'acca' }));
    expect(focusedQuery()).toBe('{"type":"acca"}');
    expect(focusedPath()).toBe('/myBets/42?type=acca');
  });
});

describe.each<Platform>(['web', 'native'])('B5 exact:false routes keep trailing segments (%s)', (platform) => {
  it('navigate("/bets/123") stays at /bets/123', () => {
    renderApp(platform, { initialUrl: '/myBets' });
    act(() => captured.screen!.navigate('/bets/123?x=1'));
    expect(focusedPath()).toBe('/bets/123?x=1');
  });
});

describe('B3 nested navigators', () => {
  const RootStack = createTestStackNavigator();
  const Tab = createTestTabNavigator();
  const HomeStack = createTestStackNavigator();
  const BetsStack = createTestStackNavigator();

  const nestedRoutes = defineRoutes({
    Feed: { path: '/', component: () => <Screen name="Feed" />, native: true, nestedIn: ['Tabs', 'HomeTab'] },
    MyBets: { path: '/myBets', component: () => <Screen name="MyBets" />, native: true, nestedIn: ['Tabs', 'BetsTab'] },
    Ticket: {
      path: '/myBets/:id',
      component: () => <Screen name="Ticket" />,
      native: true,
      nestedIn: ['Tabs', 'BetsTab'],
    },
    Settings: { path: '/settings', component: () => <Screen name="Settings" />, native: true },
  });

  function HomeTab() {
    return <NativeRouterView navigator={HomeStack} scope={['Tabs', 'HomeTab']} />;
  }
  function BetsTab() {
    return <NativeRouterView navigator={BetsStack} scope={['Tabs', 'BetsTab']} />;
  }
  function Tabs() {
    return (
      <Tab.Navigator>
        <Tab.Screen name="HomeTab" component={HomeTab} />
        <Tab.Screen name="BetsTab" component={BetsTab} />
      </Tab.Navigator>
    );
  }

  function renderNested(initialUrl?: string, linkingPrefixes?: string[]) {
    return render(
      <NativeRouterProvider routes={nestedRoutes} initialUrl={initialUrl} openWeb={() => {}} linkingPrefixes={linkingPrefixes}>
        <NativeRouterView navigator={RootStack} initialRouteName="Tabs">
          <RootStack.Screen name="Tabs" component={Tabs} />
        </NativeRouterView>
      </NativeRouterProvider>,
    );
  }

  it('navigates from one tab to a screen in another, not yet mounted, tab', () => {
    renderNested();
    expect(focusedPath()).toBe('/');
    act(() => captured.screen!.navigate('Ticket', { id: '42' }, { query: { type: 'million' } }));
    expect(focusedPath()).toBe('/myBets/42?type=million');
    expect(screen.getByTestId('rn-tab-BetsTab')).toHaveAttribute('data-focused', 'true');
    // Back returns to where we came from, like web history.
    act(() => captured.screen!.goBack());
    expect(focusedPath()).toBe('/');
  });

  it('navigates across tabs when the other tab is already mounted', () => {
    renderNested();
    act(() => captured.screen!.navigate('MyBets'));
    act(() => captured.screen!.navigate('Feed'));
    expect(focusedPath()).toBe('/');
    act(() => captured.screen!.navigate('Ticket', { id: '7' }));
    expect(focusedPath()).toBe('/myBets/7');
    expect(screen.getByTestId('rn-tab-BetsTab')).toHaveAttribute('data-focused', 'true');
  });

  it('navigates from a tab to a root-stack screen and back', () => {
    renderNested();
    act(() => captured.screen!.navigate('Settings'));
    expect(focusedPath()).toBe('/settings');
    act(() => captured.screen!.goBack());
    expect(focusedPath()).toBe('/');
  });

  it('opens from a path into a nested screen', () => {
    renderNested('/myBets/42?type=million');
    expect(focusedPath()).toBe('/myBets/42?type=million');
    expect(screen.getByTestId('rn-tab-BetsTab')).toHaveAttribute('data-focused', 'true');
  });

  it('generated linking builds nested state and nested screens config', () => {
    const linking = createLinking(nestedRoutes, ['myapp://']);
    const state: any = linking.getStateFromPath!('myBets/42?type=million', linking.config as any);
    expect(state.routes[0].name).toBe('Tabs');
    expect(state.routes[0].state.routes[0].name).toBe('BetsTab');
    expect(state.routes[0].state.routes[0].state.routes[0]).toMatchObject({ name: 'Ticket', params: { id: '42' } });
    expect(linking.getPathFromState!(state, linking.config as any)).toBe('/myBets/42?type=million');
    const screens: any = nestedRoutes.toLinkingConfig().config.screens;
    expect(screens.Tabs.screens.BetsTab.screens.Ticket.path).toBe('myBets/:id');
    expect(screens.Settings.path).toBe('settings');
  });
});
