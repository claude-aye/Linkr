/**
 * A provider's public name, as SQL — the single source of the rule
 * "`business_name`, falling back to the organization's `display_name`".
 *
 * ⚠️ THIS EXISTS SO THE RULE HAS ONE SQL SOURCE. Two readers now project it:
 * discovery (a result card) and the client's received-quotes list (a quote
 * card). Writing the COALESCE inline in the second one would have been shorter
 * and would have worked on the day it was written; it is also how two surfaces
 * end up naming the same provider differently, with no error anywhere. Same
 * reasoning, same shape as `eligibility.sql.ts`.
 *
 * The fallback is a correlated scalar on the `organization_id` FK rather than a
 * JOIN: `organizations.id` is the PK, so it yields exactly one value or NULL,
 * and it adds no alias to the embedding query.
 *
 * ⚠️ ALIAS CONTRACT: the embedding query MUST name the provider row `sp`. The
 * `o` alias is scoped inside the scalar subquery and cannot collide.
 *
 * Not covered: `ServiceProvidersService.toResponse` resolves the same rule in
 * TypeScript for the public profile (`GET /service-providers/:id`). That copy
 * predates this file and reads a record, not a row; converging it is a
 * separate change.
 */
export const PROVIDER_DISPLAY_NAME_SQL = `COALESCE(
           sp.business_name,
           (SELECT o.display_name FROM organizations o WHERE o.id = sp.organization_id)
         )` as const;
