import { EntityManager, Repository } from 'typeorm';
import { Quote } from '../entities/quote.entity';
import { QuoteRepository } from './quote.repository';

/**
 * `rejectSiblings` returns the rows it transitioned — the recipient list of the
 * « not selected » email (PR 5).
 *
 * The postgres driver hands an `UPDATE … RETURNING` back as `[rows, affected]`.
 * Read naively, `result.length` is 2 even on ZERO rows — here that would be two
 * phantom recipients. These tests feed the method the driver's real shapes.
 *
 * The SQL predicate itself (SUBMITTED only, never the accepted quote) is
 * pinned by text: it is what keeps WITHDRAWN and EXPIRED quotes out of the
 * list, and a mock cannot evaluate it. The smoke exercises it for real.
 */

function repoWith(queryResult: unknown) {
  const query = jest.fn().mockResolvedValue(queryResult);
  const repo = new QuoteRepository({} as unknown as Repository<Quote>);
  return { repo, query, manager: { query } as unknown as EntityManager };
}

describe('QuoteRepository.rejectSiblings', () => {
  it('maps the RETURNING rows to { quoteId, serviceProviderId }', async () => {
    const { repo, manager } = repoWith([
      [
        { id: 'q-b', service_provider_id: 'p-b' },
        { id: 'q-c', service_provider_id: 'p-c' },
      ],
      2,
    ]);

    await expect(repo.rejectSiblings('r-1', 'q-a', manager)).resolves.toEqual([
      { quoteId: 'q-b', serviceProviderId: 'p-b' },
      { quoteId: 'q-c', serviceProviderId: 'p-c' },
    ]);
  });

  it('zero rows touched is an EMPTY list, never two phantom entries', async () => {
    const { repo, manager } = repoWith([[], 0]);

    await expect(repo.rejectSiblings('r-1', 'q-a', manager)).resolves.toEqual([]);
  });

  it('only SUBMITTED siblings, never the accepted quote, and returns the provider', async () => {
    const { repo, query, manager } = repoWith([[], 0]);

    await repo.rejectSiblings('r-1', 'q-a', manager);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/AND id <> \$2/);
    expect(sql).toMatch(/AND status = 'SUBMITTED'/);
    expect(sql).toMatch(/RETURNING id, service_provider_id/);
    expect(params).toEqual(['r-1', 'q-a']);
  });
});
