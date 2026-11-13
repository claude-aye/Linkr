import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Controller, Delete, Get, Patch, Post, Put, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { EmailVerifiedGuard } from './email-verified.guard';
import { REQUIRE_VERIFIED_EMAIL_KEY, RequireVerifiedEmail } from './require-verified-email.decorator';

/**
 * L3 — CLASSIFICATION OF EVERY WRITE ROUTE (durable guard-rail, `CLAUDE.md` §13).
 *
 * Every POST / PUT / PATCH / DELETE route of the API is EITHER decorated with
 * `@RequireVerifiedEmail()` OR listed below with a one-line reason. A new write
 * route that is neither fails this spec: whoever adds it must decide, in
 * writing, whether an unconfirmed account may use it.
 *
 * Reason prefixes:
 * - `N2` — following up work or a payment already engaged is NEVER blocked;
 * - `Public` / `Auth` — reached before or without a session, or to obtain one;
 * - `Admin` — AdminGuard, staff only;
 * - `Own` — the caller's own data, nothing reaches a third party;
 * - `À trancher` — forbidden, except the single temporary exception below.
 */
export const UNGUARDED_WRITE_ROUTES: Readonly<Record<string, string>> = {
  // auth
  'POST /auth/signup': 'Auth: creates the account, no session yet.',
  'POST /auth/login': 'Auth: obtains a session.',
  'POST /auth/refresh': 'Auth: renews a session.',
  'POST /auth/forgot-password': 'Auth: public, recovering access.',
  'POST /auth/reset-password': 'Auth: public, recovering access.',
  'POST /auth/verify-email': 'Auth: the confirmation itself.',
  'POST /auth/verify-email/resend': 'Auth: the way out of the 403 — never block it.',
  'POST /auth/apple/callback': 'Auth: OAuth callback (not exposed on the web).',
  'POST /webhooks/stripe': 'Public: Stripe signature, no user.',
  // own account and settings
  'PATCH /users/me': 'Own: editing own settings.',
  'DELETE /users/me': 'Own: closing the account.',
  'PATCH /notifications/:id/read': 'Own: own notifications.',
  'POST /payment-methods/setup-intent':
    'À trancher: prerequisite of POST /payment-methods (guarded); D2 forbids any other change in payments. Voir L3b-B.',
  'POST /payment-methods/:id/default': 'Own: choosing among own saved cards.',
  'DELETE /payment-methods/:id': 'Own: removing an own card.',
  'POST /service-providers/:id/connect/sync': 'Own: re-reads own Connect status from Stripe, creates nothing.',
  // follow-up of work or payment already engaged (rule N2)
  'PATCH /service-requests/:id/cancel': 'N2: cancelling an existing request.',
  'POST /service-requests/:id/decline': 'N2: declining an existing request.',
  'POST /service-requests/:id/start': 'N2: starting assigned work.',
  'POST /service-requests/:id/complete': 'N2: completing assigned work.',
  'POST /service-requests/:id/confirm-completion': 'N2: confirming completion and releasing the balance.',
  'POST /service-requests/:id/contest': 'N2: contesting a completed job.',
  'POST /service-requests/:id/retry-deposit': 'N2: retrying a deposit.',
  'POST /service-requests/:id/deposit-confirmation': 'N2: confirming an engaged deposit (3-D Secure).',
  'POST /service-requests/:id/balance-confirmation': 'N2: confirming an engaged balance (3-D Secure).',
  'POST /quotes/:id/withdraw': 'N2: withdrawing an own existing quote.',
  'DELETE /reviews/:id': "N2: the author's right to withdraw a review (D-3).",
  // classified in L3b-A (CLAUDE.md §13 nº 24)
  'POST /service-requests/:id/accept':
    'N2: accepting what was already received continues an engaged flow; creation of the request is guarded (D-L3b-1).',
  'POST /quotes/:id/accept':
    'N2: accepting what was already received continues an engaged flow; creation of the quote is guarded (D-L3b-1).',
  'DELETE /service-requests/:id/attachments/:attachmentId': 'Own: edits an own object whose creation is guarded.',
  'POST /demand-signals':
    'Own: anonymous demand signal, reaches no one; the web ignores the reply (D-L3b-2). Rate cap is per caller.',
  'PATCH /service-providers/:id': 'Own: edits an own object whose creation is guarded.',
  'DELETE /service-providers/:id': 'Own: removing own provider profile.',
  'PATCH /service-providers/:id/zones/:zoneId': 'Own: edits an own object whose creation is guarded.',
  'DELETE /service-providers/:id/zones/:zoneId': 'Own: removing a service zone.',
  'PATCH /service-providers/:providerId/categories/:pscId':
    'Own: pausing a trade is a protective gesture; its creation is guarded.',
  'DELETE /service-providers/:providerId/categories/:pscId': 'Own: retiring a trade.',
  'PATCH /service-providers/:providerId/services/:serviceId': 'Own: edits an own object whose creation is guarded.',
  'DELETE /service-providers/:providerId/services/:serviceId': 'Own: removing a service.',
  'PUT /service-providers/me/portfolio/order': 'Own: edits an own object whose creation is guarded.',
  'PATCH /service-providers/me/portfolio/:itemId': 'Own: edits an own object whose creation is guarded.',
  'DELETE /service-providers/me/portfolio/:itemId': 'Own: removing a portfolio photo.',
  'PATCH /organizations/:id': 'Own: edits an own object whose creation is guarded.',
  'DELETE /organizations/:id': 'Own: removes an own organization whose creation is guarded.',
  'DELETE /organizations/:orgId/members/me': 'Own: leaving an organization.',
  'DELETE /organizations/:orgId/members/:membershipId':
    'Own: removing a member, also the remedy to an unwanted addition; adding is guarded.',
  // staff
  'POST /admin/payments/:id/refund': 'Admin.',
  'DELETE /admin/portfolio/:itemId': 'Admin.',
  'POST /admin/quotes/run-expiry-check': 'Admin.',
  'POST /admin/service-requests/run-expiry-check': 'Admin.',
  'POST /admin/service-categories': 'Admin.',
  'PATCH /admin/service-categories/:id': 'Admin.',
  'DELETE /admin/service-categories/:id': 'Admin.',
  'POST /admin/service-items': 'Admin.',
  'PATCH /admin/service-items/:id': 'Admin.',
  'POST /admin/service-items/:id/approve': 'Admin.',
  'POST /admin/service-items/:id/reject': 'Admin.',
  'DELETE /admin/service-items/:id': 'Admin.',
  'POST /admin/regulatory-requirements': 'Admin.',
  'PATCH /admin/regulatory-requirements/:id': 'Admin.',
  'DELETE /admin/regulatory-requirements/:id': 'Admin.',
  'POST /admin/verification-documents/:id/approve': 'Admin.',
  'POST /admin/verification-documents/:id/reject': 'Admin.',
  'POST /admin/verifications/run-expiry-check': 'Admin.',
};

/** D1 + L3b-A — the writes that create an object or an effect on a third party (18). Pinned so a removal is noticed too. */
const GUARDED_WRITE_ROUTES = [
  'POST /reviews/:id/response',
  'POST /service-requests/:id/attachments',
  'POST /service-providers/:id/zones',
  'POST /service-items/suggest',
  'POST /organizations',
  'POST /organizations/:orgId/members',
  'PUT /organizations/:orgId/members/:membershipId/role',
  'POST /service-requests',
  'POST /service-requests/:id/quotes',
  'POST /reviews',
  'POST /service-providers',
  'POST /service-providers/:providerId/categories',
  'POST /service-providers/:providerId/categories/:pscId/services',
  'POST /service-providers/me/portfolio',
  'POST /service-providers/:providerId/categories/:pscId/documents',
  'POST /service-providers/:id/connect/onboard',
  'POST /service-providers/:id/connect/refresh-link',
  'POST /payment-methods',
].sort();

/** Retirée par L3b-B : seule route encore « À trancher » (payments, hors périmètre de L3b-A). */
const TEMPORARY_A_TRANCHER_EXCEPTIONS = ['POST /payment-methods/setup-intent'];

/** Rule N2 — never guarded: start, complete, confirm, contest, retry a deposit, cancel, decline. */
const N2_ROUTES = [
  'POST /service-requests/:id/start',
  'POST /service-requests/:id/complete',
  'POST /service-requests/:id/confirm-completion',
  'POST /service-requests/:id/contest',
  'POST /service-requests/:id/retry-deposit',
  'PATCH /service-requests/:id/cancel',
  'POST /service-requests/:id/decline',
];

const WRITE_METHODS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

interface WriteRoute {
  key: string;
  marked: boolean;
  guarded: boolean;
}

function joinPath(...parts: unknown[]): string {
  const segments = parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter(Boolean);
  return `/${segments.join('/')}`;
}

/** Every write route declared by the given controller classes, read from Nest metadata. */
export function writeRoutesOf(controllers: Function[]): WriteRoute[] {
  const routes: WriteRoute[] = [];
  for (const controller of controllers) {
    const base = Reflect.getMetadata(PATH_METADATA, controller);
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const method = WRITE_METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      if (!method || !Reflect.hasMetadata(PATH_METADATA, handler)) continue;
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
      routes.push({
        key: `${method} ${joinPath(base, Reflect.getMetadata(PATH_METADATA, handler))}`,
        marked: Reflect.getMetadata(REQUIRE_VERIFIED_EMAIL_KEY, handler) === true,
        guarded: guards.includes(EmailVerifiedGuard),
      });
    }
  }
  return routes;
}

/** Write routes neither decorated nor listed — must be empty. */
export function unclassified(routes: WriteRoute[], allowList: Readonly<Record<string, string>>): string[] {
  return routes.filter((r) => !r.marked && !(r.key in allowList)).map((r) => r.key);
}

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

function allControllers(): Function[] {
  return controllerFiles(path.join(__dirname, '..', '..', 'modules')).flatMap((file) =>
    Object.values(require(file) as Record<string, unknown>).filter(
      (v): v is Function => typeof v === 'function' && Reflect.hasMetadata(PATH_METADATA, v),
    ),
  );
}

describe('L3 — every write route is classified', () => {
  const controllers = allControllers();
  const routes = writeRoutesOf(controllers);
  const keys = routes.map((r) => r.key);

  it('finds the controllers and their write routes', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(30);
    expect(routes.length).toBe(Object.keys(UNGUARDED_WRITE_ROUTES).length + GUARDED_WRITE_ROUTES.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every write route is guarded or listed in UNGUARDED_WRITE_ROUTES', () => {
    expect(unclassified(routes, UNGUARDED_WRITE_ROUTES)).toEqual([]);
  });

  it('guards exactly the D1 routes, each through the decorator (marker AND guard)', () => {
    const guarded = routes.filter((r) => r.marked).map((r) => r.key).sort();
    expect(guarded).toEqual(GUARDED_WRITE_ROUTES);
    for (const r of routes) expect(r.guarded).toBe(r.marked);
  });

  it('no listed route is stale or also guarded, and every reason is one line', () => {
    for (const [key, reason] of Object.entries(UNGUARDED_WRITE_ROUTES)) {
      expect(keys).toContain(key);
      expect(GUARDED_WRITE_ROUTES).not.toContain(key);
      expect(reason.trim().length).toBeGreaterThan(0);
      expect(reason).not.toMatch(/\n/);
    }
  });

  it('no reason starts with « À trancher », except the temporary L3b-B exception', () => {
    const offenders = Object.entries(UNGUARDED_WRITE_ROUTES)
      .filter(([, reason]) => reason.startsWith('À trancher'))
      .map(([key]) => key)
      .sort();
    expect(offenders).toEqual(TEMPORARY_A_TRANCHER_EXCEPTIONS);
  });

  it('rule N2: the follow-up routes are NOT guarded', () => {
    for (const key of N2_ROUTES) {
      const route = routes.find((r) => r.key === key);
      expect(route).toBeDefined();
      expect(route?.marked).toBe(false);
      expect(route?.guarded).toBe(false);
      expect(UNGUARDED_WRITE_ROUTES[key]).toMatch(/^N2:/);
    }
  });

  it('the guard is never applied class-wide', () => {
    for (const c of controllers) {
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, c) ?? [];
      expect(guards).not.toContain(EmailVerifiedGuard);
    }
  });

  it('an invented write route that is not classified fails the check', () => {
    @Controller('invented')
    class InventedController {
      @Get() read(): void {}
      @Post() create(): void {}
      @Put(':id') replace(): void {}
      @RequireVerifiedEmail() @Patch(':id') change(): void {}
      @Delete(':id') remove(): void {}
    }
    const invented = writeRoutesOf([InventedController]);
    expect(unclassified(invented, UNGUARDED_WRITE_ROUTES)).toEqual([
      'POST /invented',
      'PUT /invented/:id',
      'DELETE /invented/:id',
    ]);
    expect(unclassified(invented, { 'POST /invented': 'x', 'PUT /invented/:id': 'x', 'DELETE /invented/:id': 'x' })).toEqual([]);
  });
});
