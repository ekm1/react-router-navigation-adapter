import { defineRoutes, type RouteRegistry } from '../src/index';
import { MyBetsScreen, PromotionsPage, SettledScreen, TicketScreen } from './SharedScreens';

/**
 * Defined once for both platforms.
 * - `native: true` routes are React Navigation screens on native; everything else opens in the WebView.
 * - Matching is first-match in declaration order: static routes before dynamic ones.
 */
export const routes = defineRoutes({
  MyBets: { path: '/myBets', component: MyBetsScreen, native: true, options: { title: 'My Bets' } },
  Settled: { path: '/myBets/settled', component: SettledScreen, native: true },
  Ticket: {
    path: '/myBets/:id',
    component: TicketScreen,
    native: true,
    parent: 'MyBets', // goBack() target after a deep link (when no onBackAtRoot handles it)
    options: { title: 'Ticket' },
  },
  Promotions: { path: '/promotions', component: PromotionsPage }, // web only
});

export type RouteName = typeof routes extends RouteRegistry<infer N> ? N : never;
