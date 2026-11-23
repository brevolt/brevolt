/* TanStack Router signals redirects by throwing a `redirect()` object. */
/* eslint-disable @typescript-eslint/only-throw-error */
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { api } from './lib/api.js';
import { ContactDetailPage } from './pages/ContactDetailPage.js';
import { ContactsLayout, ContactsIndex } from './pages/ContactsLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { NewContactPage } from './pages/NewContactPage.js';
import { SyncPage } from './pages/SyncPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { Shell } from './components/Shell.js';

const rootRoute = createRootRoute({ component: Outlet });

const signedIn = (): boolean => api.csrf() !== '';

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: signedIn() ? '/contacts' : '/login' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => {
    if (signedIn()) throw redirect({ to: '/contacts' });
  },
  component: LoginPage,
});

/** Everything below needs a session; the server already redirects, this covers client-side moves. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: () => {
    if (!signedIn()) throw redirect({ to: '/login' });
  },
  component: Shell,
});

const contactsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contacts',
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === 'string' && search.q ? { q: search.q } : {},
  component: ContactsLayout,
});
const contactsIndexRoute = createRoute({
  getParentRoute: () => contactsRoute,
  path: '/',
  component: ContactsIndex,
});
const newContactRoute = createRoute({
  getParentRoute: () => contactsRoute,
  path: 'new',
  component: NewContactPage,
});
const contactRoute = createRoute({
  getParentRoute: () => contactsRoute,
  path: '$id',
  component: ContactDetailPage,
});
const syncRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sync',
  component: SyncPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  appRoute.addChildren([
    contactsRoute.addChildren([contactsIndexRoute, newContactRoute, contactRoute]),
    syncRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
