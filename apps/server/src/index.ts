export const PACKAGE_NAME = '@brevolt/server';
export * from './config.js';
export * from './logger.js';
export { openDatabase, schema, type HubDatabase, type OpenedDatabase } from './db/index.js';
export * from './auth/tokens.js';
export * from './auth/rate-limit.js';
export { tokenAuthPlugin, isInScope, type TokenAuthOptions } from './auth/plugin.js';
export { contactRoutes, type ContactRoutesOptions } from './contacts/routes.js';
export { ContactService, type ContactView } from './contacts/service.js';
export * from './auth/admin.js';
export {
  dashboardAuthPlugin,
  parseCookies,
  SESSION_COOKIE,
  LOGIN_CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_FIELD,
  type DashboardAuthOptions,
} from './auth/dashboard.js';
