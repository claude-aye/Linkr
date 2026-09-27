import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './repositories/notifications.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { UsersRepository } from '../users/users.repository';
import { EmailService } from '../../common/email/email.service';

/**
 * PR 5 — how the three quote emails find their recipients.
 *
 * Pinned here: the template each one uses, the EXACT absolute link, and the
 * isolation rule — one try/catch per recipient, so provider B failing (lookup
 * or enqueue) never costs provider C their email, and no method ever throws.
 * Skipped recipients: an ORGANIZATION is a warning; a provider or owner that is
 * gone is silent.
 */

const BASE_URL = 'https://linkr.test';
const REQUEST = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Rénovation de salle de bain',
  clientUserId: '11111111-1111-4111-8111-111111111111',
};

type Person = { id: string; email: string; firstName: string };
const people: Record<string, Person> = {
  client: { id: REQUEST.clientUserId, email: 'alice@linkr.test', firstName: 'Alice' },
  dana: { id: 'u-dana', email: 'dana@linkr.test', firstName: 'Dana' },
  bob: { id: 'u-bob', email: 'bob@linkr.test', firstName: 'Bob' },
  carl: { id: 'u-carl', email: 'carl@linkr.test', firstName: 'Carl' },
};

/** provider id → owner user id (null = ORGANIZATION). */
const providers: Record<string, string | null> = {
  'p-dana': 'u-dana',
  'p-bob': 'u-bob',
  'p-carl': 'u-carl',
  'p-org': null,
  'p-orphan': 'u-deleted',
};

function harness() {
  const send = jest.fn().mockResolvedValue(undefined);
  const providerFindById = jest.fn(async (id: string) =>
    id in providers ? { id, userId: providers[id] } : null,
  );
  const userFindById = jest.fn(
    async (id: string) => Object.values(people).find((p) => p.id === id) ?? null,
  );

  const config = {
    getOrThrow: jest.fn().mockReturnValue(72),
    get: jest.fn((key: string) => (key === 'WEB_APP_BASE_URL' ? BASE_URL : undefined)),
  };

  const service = new NotificationsService(
    {} as unknown as NotificationsRepository,
    { findById: providerFindById } as unknown as ServiceProviderRepository,
    { findById: userFindById } as unknown as UsersRepository,
    { send } as unknown as EmailService,
    config as unknown as ConfigService,
    {} as unknown as DataSource,
  );

  return { service, send, providerFindById, userFindById };
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;
let debug: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const recipients = (send: jest.Mock) =>
  send.mock.calls.map(([job]) => (job as { to: string }).to);

describe('notifyQuoteReceived', () => {
  it('sends quote-received to the client, linking to THIS request’s quotes page', async () => {
    const h = harness();

    await h.service.notifyQuoteReceived(REQUEST);

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith({
      to: 'alice@linkr.test',
      template: 'quote-received',
      vars: {
        firstName: 'Alice',
        requestTitle: REQUEST.title,
        quotesUrl: `${BASE_URL}/requests/${REQUEST.id}/devis`,
      },
    });
  });

  it('a deleted client is a silent skip (debug), not a warning', async () => {
    const h = harness();

    await h.service.notifyQuoteReceived({ ...REQUEST, clientUserId: 'u-deleted' });

    expect(h.send).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalled();
  });

  it('never throws when the enqueue fails — it logs', async () => {
    const h = harness();
    h.send.mockRejectedValue(new Error('redis down'));

    await expect(h.service.notifyQuoteReceived(REQUEST)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('notifyQuoteAccepted', () => {
  it('sends quote-accepted to the provider owner, on the jobs tab', async () => {
    const h = harness();

    await h.service.notifyQuoteAccepted(REQUEST, 'p-dana');

    expect(h.send).toHaveBeenCalledWith({
      to: 'dana@linkr.test',
      template: 'quote-accepted',
      vars: {
        firstName: 'Dana',
        requestTitle: REQUEST.title,
        dashboardUrl: `${BASE_URL}/dashboard?onglet=jobs`,
      },
    });
  });

  it('an ORGANIZATION provider is a contextualised warning, no send', async () => {
    const h = harness();

    await h.service.notifyQuoteAccepted(REQUEST, 'p-org');

    expect(h.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('p-org'));
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining(REQUEST.id));
  });

  it('never throws when the enqueue fails', async () => {
    const h = harness();
    h.send.mockRejectedValue(new Error('redis down'));

    await expect(h.service.notifyQuoteAccepted(REQUEST, 'p-dana')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('notifyQuotesNotSelected', () => {
  it('sends quote-not-selected to each listed provider, on the tenders tab', async () => {
    const h = harness();

    await h.service.notifyQuotesNotSelected(REQUEST, ['p-bob', 'p-carl']);

    expect(recipients(h.send)).toEqual(['bob@linkr.test', 'carl@linkr.test']);
    for (const [job] of h.send.mock.calls) {
      expect(job).toEqual(
        expect.objectContaining({
          template: 'quote-not-selected',
          vars: expect.objectContaining({
            requestTitle: REQUEST.title,
            dashboardUrl: `${BASE_URL}/dashboard?onglet=appels-offres`,
          }),
        }),
      );
    }
  });

  it('writes to nobody it was not given', async () => {
    const h = harness();

    await h.service.notifyQuotesNotSelected(REQUEST, ['p-bob']);

    expect(recipients(h.send)).toEqual(['bob@linkr.test']);
  });

  it('an enqueue failure for B does not stop C, and does not throw', async () => {
    const h = harness();
    h.send.mockImplementation(async (job: { to: string }) => {
      if (job.to === 'bob@linkr.test') throw new Error('redis blink');
    });

    await expect(
      h.service.notifyQuotesNotSelected(REQUEST, ['p-bob', 'p-carl']),
    ).resolves.toBeUndefined();

    expect(recipients(h.send)).toEqual(['bob@linkr.test', 'carl@linkr.test']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toEqual(expect.stringContaining('p-bob'));
  });

  it('a lookup failure for B does not stop C', async () => {
    const h = harness();
    const real = h.providerFindById.getMockImplementation()!;
    h.providerFindById.mockImplementation(async (id: string) => {
      if (id === 'p-bob') throw new Error('db blink');
      return real(id);
    });

    await h.service.notifyQuotesNotSelected(REQUEST, ['p-bob', 'p-carl']);

    expect(recipients(h.send)).toEqual(['carl@linkr.test']);
  });

  it('skips an ORGANIZATION (warn) and a deleted owner (silent), and still reaches the rest', async () => {
    const h = harness();

    await h.service.notifyQuotesNotSelected(REQUEST, ['p-org', 'p-orphan', 'p-gone', 'p-carl']);

    expect(recipients(h.send)).toEqual(['carl@linkr.test']);
    // Only the organization warrants a warning; a gone provider or owner is debug.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('p-org'));
    expect(debug).toHaveBeenCalledTimes(2);
  });
});
