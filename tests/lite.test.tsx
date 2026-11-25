import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Switch } from 'react-router-dom';
import { NavigationContainer, getStateFromPath } from '@react-navigation/native';
import * as LiteWeb from '../src/lite/index.web';
import * as LiteNative from '../src/lite/index.native';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import { createTestTabNavigator } from './helpers/createTestTabNavigator';
import type { GetUserConfirmation } from '../src/types';
import type { LiteConfigValue, LiteRouter } from '../src/lite/shared';

type Platform = 'web' | 'native';
const apis = { web: LiteWeb, native: LiteNative } as const;

// Shared libraries compile against one platform's types: both entries must expose the same API.
export const webMatchesNative: typeof LiteWeb = LiteNative;
export const nativeMatchesWeb: typeof LiteNative = LiteWeb;

const captured: { router: LiteRouter | null } = { router: null };
const mounts: Record<string, number> = {};
afterEach(() => {
  captured.router = null;
  for (const key of Object.keys(mounts)) delete mounts[key];
});

/** A "shared library": only the compact layer, no app routes. */
function createLibrary(platform: Platform, guard?: () => string | false) {
  const { useRouter, useLocation, useParams, Link, useNavigationGuard } = apis[platform];

  function Ticket() {
    const router = useRouter();
    const location = useLocation();
    const params = useParams();
    captured.router = router;
    const guardMessage = guard?.() ?? false;
    useNavigationGuard(Boolean(guardMessage), guardMessage || undefined);
    React.useEffect(() => {
      mounts.Ticket = (mounts.Ticket ?? 0) + 1;
    }, []);
    return (
      <div data-testid="ticket">
        <span data-testid="path">{location.path}</span>
        <span data-testid="query">{JSON.stringify(location.query)}</span>
        <span data-testid="params">{JSON.stringify(params)}</span>
        <span data-testid="can-go-back">{String(router.canGoBack())}</span>
        <Link to="/myBets/7" testID="link-7">
          Ticket 7
        </Link>
      </div>
    );
  }

  function MyBets() {
    const router = useRouter();
    captured.router = router;
    return (
      <div data-testid="mybets">
        <span data-testid="path">{useLocation().path}</span>
      </div>
    );
  }

  function Analytics({ events }: { events: string[] }) {
    apis[platform].useNavigationListener((location) => events.push(location.path));
    return null;
  }

  return { Ticket, MyBets, Analytics };
}

const linking = {
  prefixes: ['myapp://'],
  enabled: false, // the app's deep-link handling is irrelevant here; the config is what counts
  config: { screens: { MyBets: 'myBets', Ticket: 'myBets/:id' } },
};

function renderApp(
  platform: Platform,
  initialUrl: string,
  options: { config?: LiteConfigValue; guard?: () => string | false; events?: string[] } = {},
) {
  const { Ticket, MyBets, Analytics } = createLibrary(platform, options.guard);
  const { LiteConfig } = apis[platform];
  const events = options.events ?? [];
  if (platform === 'web') {
    // The app's own React Router v5 routes.
    return render(
      <LiteConfig {...options.config}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Analytics events={events} />
          <Switch>
            <Route path="/myBets/:id" component={Ticket} />
            <Route path="/myBets" component={MyBets} />
          </Switch>
        </MemoryRouter>
      </LiteConfig>,
    );
  }
  // The app's own React Navigation navigator and linking config.
  const Stack = createTestStackNavigator();
  return render(
    <LiteConfig {...options.config}>
      <NavigationContainer linking={linking} initialState={getStateFromPath(initialUrl, linking.config) as any}>
        <Analytics events={events} />
        <Stack.Navigator>
          <Stack.Screen name="MyBets" component={MyBets} />
          <Stack.Screen name="Ticket" component={Ticket} />
        </Stack.Navigator>
      </NavigationContainer>
    </LiteConfig>,
  );
}

const visible = (testId: string) =>
  screen.queryAllByTestId(testId).find((el) => (el.closest('[data-focused]')?.getAttribute('data-focused') ?? 'true') === 'true');
const text = (testId: string) => visible(testId)?.textContent;

describe.each<Platform>(['web', 'native'])('compact layer on plain app routes (%s)', (platform) => {
  it('reads location, query and path params', () => {
    renderApp(platform, '/myBets/42?type=million');
    expect(text('path')).toBe('/myBets/42?type=million');
    expect(text('query')).toBe('{"type":"million"}');
    expect(text('params')).toBe('{"id":"42"}');
  });

  it('navigate adds an entry (ticket 1 -> ticket 2 -> back returns to 1)', () => {
    renderApp(platform, '/myBets');
    act(() => captured.router!.navigate('/myBets/1'));
    act(() => captured.router!.navigate('/myBets/2'));
    expect(text('path')).toBe('/myBets/2');
    expect(text('can-go-back')).toBe('true');
    act(() => captured.router!.goBack());
    expect(text('path')).toBe('/myBets/1');
  });

  it('navigate to the current URL does not add an entry', () => {
    renderApp(platform, '/myBets/5');
    act(() => captured.router!.navigate('/myBets/5'));
    expect(text('can-go-back')).toBe('false');
  });

  it('setQuery merges and keeps the screen mounted; query-only strings work', () => {
    renderApp(platform, '/myBets/5?type=million');
    act(() => captured.router!.setQuery({ page: 2 }));
    expect(text('path')).toBe('/myBets/5?type=million&page=2');
    act(() => captured.router!.replace('?type=acca'));
    expect(text('query')).toBe('{"type":"acca"}');
    expect(mounts.Ticket).toBe(1);
  });

  it('Link navigates', () => {
    renderApp(platform, '/myBets/5');
    fireEvent.click(visible('link-7')!);
    expect(text('path')).toBe('/myBets/7');
  });

  it('goBack at the root: LiteConfig onBackAtRoot, else the fallback', () => {
    const onBackAtRoot = vi.fn();
    const { unmount } = renderApp(platform, '/myBets/5', { config: { onBackAtRoot } });
    act(() => captured.router!.goBack('/myBets'));
    expect(onBackAtRoot).toHaveBeenCalledTimes(1);
    unmount();
    renderApp(platform, '/myBets/5');
    act(() => captured.router!.goBack('/myBets'));
    expect(visible('mybets')).toBeTruthy();
  });

  it('guards: back and pushes away are blocked until confirmed; query-only changes pass', () => {
    const answers = [false, true, false];
    const getUserConfirmation = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? false));
    let guarded = false;
    renderApp(platform, '/myBets', { config: { getUserConfirmation }, guard: () => (guarded ? 'Discard bet slip?' : false) });
    act(() => captured.router!.navigate('/myBets/1'));
    guarded = true;
    act(() => captured.router!.setQuery({ type: 'single' })); // query-only: passes, re-renders with the guard on
    expect(getUserConfirmation).not.toHaveBeenCalled();

    act(() => captured.router!.navigate('/myBets/2')); // declined
    expect(text('path')).toBe('/myBets/1?type=single');
    act(() => captured.router!.navigate('/myBets/2')); // accepted
    expect(text('path')).toBe('/myBets/2');
    act(() => captured.router!.goBack()); // declined
    expect(getUserConfirmation).toHaveBeenCalledTimes(3);
    expect(text('path')).toBe('/myBets/2');
    guarded = false;
  });

  it('listener reports every URL change', () => {
    const events: string[] = [];
    renderApp(platform, '/myBets', { events });
    act(() => captured.router!.navigate('/myBets/1'));
    act(() => captured.router!.setQuery({ type: 'acca' }));
    act(() => captured.router!.goBack());
    expect(events).toEqual(['/myBets/1', '/myBets/1?type=acca', '/myBets']);
  });
});

describe('compact layer, native only', () => {
  it('URLs outside the linking config go to openWeb', () => {
    const openWeb = vi.fn();
    renderApp('native', '/myBets/5', { config: { openWeb } });
    act(() => captured.router!.navigate('/promotions?x=1'));
    expect(openWeb).toHaveBeenCalledWith('/promotions?x=1');
    expect(text('path')).toBe('/myBets/5');
  });

  it('guards set preventNativeDismiss, so native-stack blocks iOS swipe-back', () => {
    renderApp('native', '/myBets/5', { guard: () => 'Discard?' });
    expect(screen.getByTestId('rn-screen-Ticket')).toHaveAttribute('data-prevent-native-dismiss', 'true');
  });
});

describe('compact layer, native nested navigators', () => {
  it("navigates into another tab's stack through the app's nested linking config", () => {
    const { Ticket, MyBets } = createLibrary('native');
    const Root = createTestStackNavigator();
    const Tab = createTestTabNavigator();
    const HomeStack = createTestStackNavigator();
    const BetsStack = createTestStackNavigator();
    const nestedLinking = {
      prefixes: ['myapp://'],
      enabled: false,
      config: {
        screens: {
          Tabs: {
            screens: {
              HomeTab: { screens: { Feed: '' } },
              BetsTab: { screens: { MyBets: 'myBets', Ticket: 'myBets/:id' } },
            },
          },
        },
      },
    };
    function Feed() {
      captured.router = LiteNative.useRouter();
      return <span data-testid="path">{LiteNative.useLocation().path}</span>;
    }
    const HomeTab = () => (
      <HomeStack.Navigator>
        <HomeStack.Screen name="Feed" component={Feed} />
      </HomeStack.Navigator>
    );
    const BetsTab = () => (
      <BetsStack.Navigator>
        <BetsStack.Screen name="MyBets" component={MyBets} />
        <BetsStack.Screen name="Ticket" component={Ticket} />
      </BetsStack.Navigator>
    );
    const Tabs = () => (
      <Tab.Navigator>
        <Tab.Screen name="HomeTab" component={HomeTab} />
        <Tab.Screen name="BetsTab" component={BetsTab} />
      </Tab.Navigator>
    );
    render(
      <NavigationContainer linking={nestedLinking as any}>
        <Root.Navigator>
          <Root.Screen name="Tabs" component={Tabs} />
        </Root.Navigator>
      </NavigationContainer>,
    );
    const isVisible = (el: Element) => {
      for (let node: Element | null = el.closest('[data-focused]'); node; node = node.parentElement?.closest('[data-focused]') ?? null) {
        if (node.getAttribute('data-focused') !== 'true') return false;
      }
      return true;
    };
    const path = () => screen.queryAllByTestId('path').find(isVisible)?.textContent;
    expect(path()).toBe('/');
    act(() => captured.router!.navigate('/myBets/42?type=million'));
    expect(path()).toBe('/myBets/42?type=million');
    expect(screen.getByTestId('rn-tab-BetsTab')).toHaveAttribute('data-focused', 'true');
  });
});

describe('compact layer, web only', () => {
  it('Link is a real <a href>', () => {
    renderApp('web', '/myBets/5');
    expect(visible('link-7')).toHaveAttribute('href', '/myBets/7');
  });
});
