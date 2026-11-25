import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import * as RR from 'react-router-dom';
import { defineRoutes } from '../src/routeRegistry';
import { useRoute } from '../src/hooks';
import { WebRouterProvider } from '../src/adapters/web';
import { NativeRouterProvider } from '../src/adapters/native';
import { RouterView as WebRouterView } from '../src/components/RouterView.web';
import { RouterView as NativeRouterView } from '../src/components/RouterView.native';
import { Prompt } from '../src/components/Prompt';
import * as Native from '../src/compat.native';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import type { GetUserConfirmation } from '../src/types';

type Platform = 'web' | 'native';

/** Web: React Router's own APIs. Native: the compat layer. Same call sites. */
const apis = {
  web: {
    useHistory: RR.useHistory as any,
    useRouteMatch: RR.useRouteMatch as any,
    withRouter: RR.withRouter as any,
    matchPath: RR.matchPath as any,
    generatePath: RR.generatePath as any,
  },
  native: Native,
};

const captured: { history: any; match: any; matchNonExact: any; matchExact: any; matchMiss: any } = {
  history: null,
  match: null,
  matchNonExact: null,
  matchExact: null,
  matchMiss: null,
};

let promptProps: { when: boolean; message: any } | null = null;

function createScreen(platform: Platform, name: string) {
  return function CompatScreen() {
    const api = apis[platform];
    captured.history = api.useHistory();
    captured.match = api.useRouteMatch();
    captured.matchNonExact = api.useRouteMatch('/myBets');
    captured.matchExact = api.useRouteMatch({ path: '/myBets/:id', exact: true });
    captured.matchMiss = api.useRouteMatch('/promotions');
    const route = useRoute();
    return (
      <div data-testid={`screen-${name}`}>
        <span data-testid="path">{route.path}</span>
        {promptProps ? <Prompt {...promptProps} /> : null}
      </div>
    );
  };
}

function renderApp(platform: Platform, initialUrl: string, confirm?: GetUserConfirmation, onBackAtRoot?: () => void) {
  const routes = defineRoutes({
    MyBets: { path: '/myBets', component: createScreen(platform, 'MyBets'), native: true },
    Ticket: { path: '/myBets/:id', component: createScreen(platform, 'Ticket'), native: true },
    Promotions: { path: '/promotions', component: createScreen(platform, 'Promotions'), native: true },
  });
  if (platform === 'web') {
    return render(
      <WebRouterProvider routes={routes} routerType="memory" initialEntries={[initialUrl]} getUserConfirmation={confirm}>
        <WebRouterView />
      </WebRouterProvider>,
    );
  }
  const Stack = createTestStackNavigator();
  return render(
    <NativeRouterProvider routes={routes} initialUrl={initialUrl} getUserConfirmation={confirm} onBackAtRoot={onBackAtRoot}>
      <NativeRouterView navigator={Stack} />
    </NativeRouterProvider>,
  );
}

const isVisible = (el: Element) => {
  for (let node: Element | null = el.closest('[data-focused]'); node; node = node.parentElement?.closest('[data-focused]') ?? null) {
    if (node.getAttribute('data-focused') !== 'true') return false;
  }
  return true;
};
const focusedPath = () => screen.queryAllByTestId('path').find(isVisible)?.textContent;

describe.each<Platform>(['web', 'native'])('React Router v5 compat (%s)', (platform) => {
  const api = apis[platform];

  it('history.length and an atomic history.go(-n)', () => {
    promptProps = null;
    renderApp(platform, '/myBets');
    act(() => captured.history.push('/myBets/1'));
    act(() => captured.history.push('/myBets/2'));
    expect(captured.history.length).toBe(3);
    act(() => captured.history.go(-2));
    expect(focusedPath()).toBe('/myBets');
  });

  it('history.go(-n) runs the guard once, not once per step', () => {
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(true));
    promptProps = null;
    renderApp(platform, '/myBets', confirm);
    act(() => captured.history.push('/myBets/1'));
    act(() => captured.history.push('/myBets/2'));
    promptProps = { when: true, message: 'Leave?' };
    act(() => captured.history.replace('/myBets/2?x=1')); // re-render so the Prompt mounts
    act(() => captured.history.go(-2));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(focusedPath()).toBe('/myBets');
    promptProps = null;
  });

  it('history.block(prompt) blocks until unblocked', () => {
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
    promptProps = null;
    renderApp(platform, '/myBets', confirm);
    let unblock: () => void = () => {};
    act(() => {
      unblock = captured.history.block('Discard?');
    });
    act(() => captured.history.push('/myBets/1'));
    expect(confirm).toHaveBeenCalledWith('Discard?', expect.any(Function));
    expect(focusedPath()).toBe('/myBets');
    act(() => unblock());
    act(() => captured.history.push('/myBets/1'));
    expect(focusedPath()).toBe('/myBets/1');
  });

  it('relative paths resolve against the current location', () => {
    promptProps = null;
    renderApp(platform, '/myBets/1');
    act(() => captured.history.push('42?type=million'));
    expect(focusedPath()).toBe('/myBets/42?type=million');
    act(() => captured.history.push('../promotions'));
    expect(focusedPath()).toBe('/promotions');
  });

  it('useRouteMatch: current match, prefix, exact and miss', () => {
    promptProps = null;
    renderApp(platform, '/myBets/42');
    expect(captured.match).toMatchObject({ path: '/myBets/:id', url: '/myBets/42', isExact: true, params: { id: '42' } });
    expect(captured.matchNonExact).toMatchObject({ path: '/myBets', url: '/myBets', isExact: false });
    expect(captured.matchExact).toMatchObject({ params: { id: '42' }, isExact: true });
    expect(captured.matchMiss).toBeNull();
  });

  it('matchPath and generatePath give the same results', () => {
    expect(api.matchPath('/myBets/42/legs', '/myBets/:id')).toEqual({
      path: '/myBets/:id',
      url: '/myBets/42',
      isExact: false,
      params: { id: '42' },
    });
    expect(api.matchPath('/myBets/42', { path: '/myBets/:id/:leg?', exact: true })).toEqual({
      path: '/myBets/:id/:leg?',
      url: '/myBets/42',
      isExact: true,
      params: { id: '42', leg: undefined },
    });
    expect(api.matchPath('/myBets/42/legs', { path: ['/x', '/myBets/:id'], exact: true })).toBeNull();
    expect(api.generatePath('/myBets/:id/:leg?', { id: 42 })).toBe('/myBets/42');
    expect(api.generatePath('/myBets/:id', { id: 'a b' })).toBe('/myBets/a%20b');
  });

  it('<Prompt message={fn}> receives the target location and action', () => {
    const message = vi.fn((location: any, _action: string) =>
      location.pathname === '/promotions' ? 'Leave My Bets?' : true,
    );
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
    promptProps = { when: true, message };
    renderApp(platform, '/myBets', confirm);
    act(() => captured.history.push('/myBets/1'));
    expect(message).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: '/myBets/1' }), 'PUSH');
    expect(focusedPath()).toBe('/myBets/1');
    act(() => captured.history.push('/promotions'));
    expect(confirm).toHaveBeenCalledWith('Leave My Bets?', expect.any(Function));
    expect(focusedPath()).toBe('/myBets/1');
    promptProps = null;
  });

  it('withRouter forwards wrappedComponentRef and hoists statics', () => {
    class Filters extends React.Component<any> {
      static filterKeys = ['type'];
      static defaultProps = { label: 'Filters' };
      focus = vi.fn();
      render() {
        return <span data-testid="filters">{`${this.props.label}:${this.props.location.pathname}`}</span>;
      }
    }
    const Wrapped = api.withRouter(Filters);
    expect(Wrapped.filterKeys).toEqual(['type']);
    expect(Wrapped.WrappedComponent).toBe(Filters);
    const ref = React.createRef<Filters>();
    const routes = defineRoutes({
      MyBets: { path: '/myBets', component: () => <Wrapped wrappedComponentRef={ref} />, native: true },
    });
    if (platform === 'web') {
      render(
        <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/myBets']}>
          <WebRouterView />
        </WebRouterProvider>,
      );
    } else {
      const Stack = createTestStackNavigator();
      render(
        <NativeRouterProvider routes={routes} initialUrl="/myBets">
          <NativeRouterView navigator={Stack} />
        </NativeRouterProvider>,
      );
    }
    expect(screen.getByTestId('filters')).toHaveTextContent('Filters:/myBets');
    expect(ref.current).toBeInstanceOf(Filters);
  });

  it('useRouteMatch() returns isExact: false and matched prefix url on exact:false routes', () => {
    let currentMatch: any = null;
    function BetsScreen() {
      currentMatch = api.useRouteMatch();
      return <span data-testid="bets">{useRoute().pathname}</span>;
    }
    const routes = defineRoutes({
      Bets: { path: '/bets', component: BetsScreen, native: true, exact: false },
    });
    if (platform === 'web') {
      render(
        <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/bets/123']}>
          <WebRouterView />
        </WebRouterProvider>,
      );
    } else {
      const Stack = createTestStackNavigator();
      render(
        <NativeRouterProvider routes={routes} initialUrl="/bets/123">
          <NativeRouterView navigator={Stack} />
        </NativeRouterProvider>,
      );
    }
    expect(currentMatch).toMatchObject({ path: '/bets', url: '/bets', isExact: false });
  });

  it('<Prompt message={(loc) => ...}> receives target pathname on history.replace', () => {
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
    promptProps = {
      when: true,
      message: (loc: { pathname: string }) => (loc.pathname === '/promotions' ? true : 'Leave?'),
    };
    renderApp(platform, '/myBets/1', confirm);
    act(() => captured.history.replace('/myBets'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(focusedPath()).toBe('/myBets/1');
    act(() => captured.history.replace('/promotions'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(focusedPath()).toBe('/promotions');
    promptProps = null;
  });
});

describe('Web compat only', () => {
  it("React Router's own <Prompt> and adapter guards coexist (history v4 allows one prompt)", () => {
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(true));
    const routes = defineRoutes({
      MyBets: { path: '/myBets', component: createScreen('web', 'MyBets') },
      Ticket: { path: '/myBets/:id', component: createScreen('web', 'Ticket') },
    });
    promptProps = null;
    function Shell() {
      return (
        <>
          <RR.Prompt when message="React Router prompt" />
          <Prompt when message="Adapter prompt" />
        </>
      );
    }
    render(
      <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/myBets']} getUserConfirmation={confirm}>
        <Shell />
        <WebRouterView />
      </WebRouterProvider>,
    );
    act(() => captured.history.push('/myBets/1'));
    expect(confirm.mock.calls.map((c) => c[0]).sort()).toEqual(['Adapter prompt', 'React Router prompt']);
    expect(focusedPath()).toBe('/myBets/1');
  });
});

describe('Native compat only', () => {
  it('history.go(-n) past the stack root falls back to onBackAtRoot', () => {
    const onBackAtRoot = vi.fn();
    promptProps = null;
    renderApp('native', '/myBets', undefined, onBackAtRoot);
    act(() => captured.history.push('/myBets/1'));
    act(() => captured.history.go(-5));
    expect(onBackAtRoot).toHaveBeenCalledTimes(1);
  });
});
