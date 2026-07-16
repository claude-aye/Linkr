# Linkr — AI Coding Agent Brief

**Project Codename:** Linkr
**Status:** Pre-implementation (Architecture & Stack frozen, ready to scaffold)
**Document Version:** 1.0
**Last Updated:** 2026-05-22

---

## 1. Project Vision

Linkr is a unified mobile-first platform that combines:
- The **transactional immediacy of Uber** (instant service booking, geolocation-based matching)
- The **networking and reputation power of LinkedIn** (profiles, portfolios, endorsements, B2B referrals)

It is built for **blue-collar professionals** (electricians, plumbers, carpenters) and **informal service providers** (hairdressers, decorators, handypersons, estheticians).

**Initial Market:** Quebec, Canada
**Long-term Vision:** Glocal — globally deployable with locally-toggled regulations

---

## 2. Business Model

### Dual Revenue Streams

| Customer Segment | Monetization | Notes |
|---|---|---|
| **B2C** — Independent professionals (e.g., solo hairdresser) | **10% commission** on each transaction | Aggressive vs TaskRabbit (15%) / Uber (25%+) to prevent platform leakage |
| **B2B** — Organizations / Agencies (e.g., "Plomberie ABC Inc.") | **Monthly SaaS subscription** based on active workers count | No commission on transactions. Plans: Petite Équipe (1-3 workers), Flotte (10+ workers) |

### Payment Lifecycle (MVP)

- **Deposit at booking:** 20% of estimated amount, captured when `service_request.status = ASSIGNED`
- **Balance at completion:** Remaining 80%, captured when `service_request.status = COMPLETED`
- **Quote-based requests:** Deposit captured at quote acceptance moment

### Trust System — Two-Badge Architecture

| Badge | Description | Validation |
|---|---|---|
| 🟢 **Hard Trust** | Regulated trades | Verified license (RBQ, CMEQ, CMMTQ, CCQ) per Quebec; equivalent authorities per region |
| 🟡 **Social Trust** | Informal trades | Identity verification (KYC via Stripe Connect onboarding) + community reviews |

**CRITICAL ARCHITECTURAL RULE:** Trust is at the **(Service Provider × Service Category)** level, NOT at the Provider level. A single Pro can have multiple services with different trust levels (e.g., licensed electrician for `Électricité` + informal handywork for `Homme à tout faire`).

---

## 3. Technology Stack (Frozen)

| Layer | Technology | Rationale |
|---|---|---|
| **Backend Framework** | NestJS + TypeScript | Modular by design, decorator-based RBAC, official Stripe/Auth modules |
| **ORM** | TypeORM | Native PostGIS support (spatial columns, ST_DWithin), synergistic with NestJS decorators |
| **Database** | PostgreSQL 16 + PostGIS 3.4 | Geo queries are core to the product (proximity-based discovery) |
| **Cache / Queues** | Redis 7 + BullMQ | Async tasks: webhooks Stripe, cron jobs (expired licenses), notifications |
| **Mobile** | React Native + Expo | Full TypeScript stack, OTA updates, EAS Build |
| **Web Portal** | Next.js 16 (App Router, Turbopack) | SSR pour SEO des pages org publiques ; dev sur port 3001 |
| **API Client (front)** | openapi-typescript 7.x + openapi-fetch 0.17 | Types générés depuis `openapi.json` ; client typé. openapi-fetch en maintenance mode mais feature-complete |
| **API Style** | REST + OpenAPI/Swagger | Universal, B2B-friendly, simple file uploads, NestJS-native via `@nestjs/swagger` |
| **Auth** | PassportJS | Multi-modal: Email/Password + Google OAuth + Apple Sign-In |
| **Payments** | Stripe Connect (Express type) | KYC included, lowest dev effort, upgradable to Custom later |
| **Monorepo Tool** | Turborepo + pnpm | Modern, fast, native TypeScript support, intelligent caching |
| **Containerization** | Docker + Docker Compose | Single-command dev environment |
| **Git Workflow** | GitHub Flow + Conventional Commits | Solo-friendly, auto-changelog |
| **CI/CD** | GitHub Actions (to be configured) | — |

### Mandatory Architectural Patterns

1. **Repository Pattern** — All TypeORM access goes through Repository classes. Controllers → Services → Repositories → TypeORM. This keeps the door open to migrate from TypeORM to Drizzle in 12-18 months if needed.
2. **Module-per-Domain** — Each NestJS module mirrors a database domain (UsersModule, ProvidersModule, RequestsModule, PaymentsModule, etc.).
3. **DTO Validation** — All inputs validated via `class-validator` + `class-transformer`. No raw `any` types accepted.
4. **Environment Validation** — All env vars validated at boot via `@nestjs/config` + Joi/Zod schemas. Missing var = crash on startup.

### Frontend Conventions (Phase 3.11a)

- **`apps/web`** : Next.js 16.2, App Router, `src-dir`, Tailwind, dev sur le port **3001**.
- **`packages/api-client`** consommé via `transpilePackages: ['@linkr/api-client']` (TS brut, **pas d'étape de build** dédiée).
- **Codegen** : `pnpm --filter @linkr/api-client codegen` lit `apps/api/openapi.json` → écrit `src/schema.d.ts` (**committé**).
- **`getToken`** est présent dans `createApiClient` mais **non branché** jusqu'à 3.11b.
- **`/health`** est documenté dans l'OpenAPI → page de connectivité entièrement typée.
- **Pattern page métier (depuis 3.11c-A)** : Server Component lit la donnée via `getServerApiClient()` (token cookie server-side) ; mutations via **Route Handlers BFF** sous `/api/...` (protégés par le proxy deny-by-default) ; rafraîchissement via `router.refresh()` (Server Component = source de vérité) ; **RBAC = l'API est seule juge**, la page gère le 403 en affichage.
- **i18n JSONB (depuis 3.11c-A-ter)** : `lib/i18n/pickTranslation(map)` résout un JSONB de traductions (`fr-CA` → `en-CA` → 1ʳᵉ clé disponible → `—`, défensif sur map nulle/vide). À réutiliser pour tout affichage de `*_translations` (catégories, items, exigences réglementaires).

---

## 4. Monorepo Structure

```
linkr/
├── apps/
│   ├── api/                    # NestJS backend (REST API)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── organizations/
│   │   │   │   ├── service-providers/
│   │   │   │   ├── services-catalog/
│   │   │   │   ├── service-requests/
│   │   │   │   ├── quotes/
│   │   │   │   ├── verifications/
│   │   │   │   ├── payments/
│   │   │   │   ├── stripe-connect/
│   │   │   │   ├── notifications/
│   │   │   │   └── admin/
│   │   │   ├── common/         # Guards, interceptors, filters, decorators
│   │   │   ├── database/       # TypeORM entities, migrations, seeders
│   │   │   ├── config/         # Env validation schemas
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   └── package.json
│   │
│   ├── web/                    # Next.js (SaaS portal for Pros/Admins)
│   │   ├── src/
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   └── package.json
│   │
│   └── mobile/                 # Expo / React Native (consumer + Pro app)
│       ├── src/
│       ├── app.json
│       ├── .env.example
│       └── package.json
│
├── packages/
│   ├── api-client/             # Client OpenAPI généré (openapi-typescript + openapi-fetch)
│   ├── shared-types/           # TypeScript interfaces shared across apps
│   ├── shared-utils/           # Validation, formatting, constants
│   └── shared-config/          # ESLint, Prettier, tsconfig.base.json
│
├── docker/
│   └── docker-compose.yml      # postgres + redis + pgadmin
│
├── .github/
│   └── workflows/              # CI/CD pipelines
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .gitignore
├── .env.example                # Root-level env example
└── README.md
```

---

## 5. Complete Database Schema

> ⚠️ **All timestamps are stored in UTC** with the explicit `_utc` suffix.
> ⚠️ **All monetary amounts** are stored alongside their **ISO 4217 currency code**.
> ⚠️ **Soft delete** (`deleted_at_utc`) is used everywhere — never hard DELETE (GDPR / Loi 25 compliance).
> ⚠️ **UUIDs** are used as primary keys throughout (not auto-increment integers) — security and distributed-system friendly.

### 5.1 Domain: User & Identity

#### `users`
The human individual. Always a customer by default; can activate Pro mode (which links them to `service_providers`).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `email` | string UNIQUE | Primary identifier |
| `email_verified_at_utc` | timestamp NULLABLE | |
| `phone` | string E.164 NULLABLE UNIQUE | International format `+15145551234` |
| `phone_verified_at_utc` | timestamp NULLABLE | |
| `first_name`, `last_name` | string | Legal identity |
| `display_name` | string NULLABLE | Public-facing alternative |
| `avatar_url` | string NULLABLE | |
| `language_preference` | string | BCP 47, e.g., `fr-CA` |
| `country_code` | ISO 3166-1 | e.g., `CA` |
| `subdivision_code` | ISO 3166-2 | e.g., `CA-QC` (required for tax/feature toggling) |
| `preferred_currency` | ISO 4217 | e.g., `CAD` (display only; transactions store their own) |
| `default_location` | PostGIS Point NULLABLE | Optional home address; mobile primarily uses live GPS |
| `verification_level` | enum (`NONE`, `EMAIL`, `PHONE`, `IDENTITY`) | State machine for progressive KYC |
| `stripe_customer_id` | string NULLABLE UNIQUE (partial) | `cus_xxx` — created lazily at first saved payment method (3.10b) |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

#### `user_auth_providers`
Multi-modal authentication support per user.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | FK → users | |
| `provider_type` | enum (`EMAIL_PASSWORD`, `GOOGLE`, `APPLE`) | |
| `provider_user_id` | string NULLABLE | OAuth `sub` claim |
| `password_hash` | string NULLABLE | Argon2id, only for `EMAIL_PASSWORD` |
| `last_used_at_utc` | timestamp | |
| `created_at_utc` | timestamp | |

**Constraints:**
- `UNIQUE(user_id, provider_type)` — One provider type per user max
- `UNIQUE(provider_type, provider_user_id)` — One Linkr account per OAuth identity

### 5.2 Domain: Organizations (B2B)

#### `organizations`
Corporate entities for B2B SaaS clients. Holds primary licenses (e.g., RBQ), branding, billing.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `legal_name` | string | E.g., "Plomberie ABC Inc." |
| `display_name` | string | Public-facing brand |
| `slug` | string UNIQUE | URL slug: `linkr.ca/o/plomberie-abc` |
| `logo_url` | string NULLABLE | |
| `description` | text | Public bio |
| `legal_address` | string | Registered address |
| `country_code` | ISO 3166-1 | |
| `subdivision_code` | ISO 3166-2 | |
| `billing_email` | string | For SaaS invoicing |
| `business_number` | string NULLABLE | NEQ (QC) / SIREN (FR) / EIN (US) |
| `is_active` | boolean | |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

#### `organization_memberships`
Links users to organizations with a role. RBAC at the org level.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `organization_id` | FK → organizations | |
| `user_id` | FK → users | |
| `role` | enum (`OWNER`, `WORKER`) | Simple RBAC for MVP |
| `joined_at_utc` | timestamp | |
| `left_at_utc` | timestamp NULLABLE | Preserves history (never DELETE) |
| `is_active` | boolean | |
| `created_at_utc`, `updated_at_utc` | timestamps | |

**Constraints:**
- `UNIQUE(organization_id, user_id) WHERE left_at_utc IS NULL` — One active membership at a time

**Role permissions:**
- `OWNER` — Billing, configures org profile, dispatches workers, full financial visibility
- `WORKER` — Sees only assigned jobs, client addresses, mark-as-completed button. No financial visibility.

### 5.3 Domain: Service Providers (Polymorphic Core)

#### `service_providers`
**Polymorphic commercial entity** — represents either an individual user or an organization that sells services on Linkr. All downstream tables (services, requests, quotes, payments) reference this table — NOT users or organizations directly.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `provider_type` | enum (`INDIVIDUAL`, `ORGANIZATION`) | **Discriminator** |
| `user_id` | FK → users NULLABLE | Filled if `INDIVIDUAL` |
| `organization_id` | FK → organizations NULLABLE | Filled if `ORGANIZATION` |
| `business_name` | string NULLABLE | For solo individuals; for orgs, defaults to `organization.display_name` |
| `headline` | string | LinkedIn-style tagline |
| `bio` | text | |
| `service_base_location` | PostGIS Point | Operational center for radius calculations |
| `service_radius_km` | int | Primary service radius (Hybrid geo model) |
| `is_active` | boolean | Pro mode can be paused (e.g., vacation) |
| `activated_at_utc` | timestamp | First Pro mode activation |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

**Constraints:**
```sql
CHECK (
  (provider_type = 'INDIVIDUAL' AND user_id IS NOT NULL AND organization_id IS NULL)
  OR
  (provider_type = 'ORGANIZATION' AND organization_id IS NOT NULL AND user_id IS NULL)
)
```

#### `professional_service_zones`
Named geographic service zones (the "Zones" part of the Hybrid geographic model).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_provider_id` | FK → service_providers | |
| `zone_polygon` | PostGIS Polygon / MultiPolygon | |
| `zone_label` | string | E.g., "Plateau Mont-Royal" |
| `created_at_utc`, `updated_at_utc` | timestamps | |

**Hybrid Geo Matching Rule:** A provider is shown to a client if EITHER:
- The client's location is within `ST_DWithin(provider.service_base_location, client.location, provider.service_radius_km * 1000)` — meters
- OR the client's location falls inside any of the provider's `professional_service_zones.zone_polygon` via `ST_Contains`

### 5.4 Domain: Services Catalog (Hybrid Model)

#### `service_categories` (Métiers)
**Top-level trades**, fully managed by Linkr admins (closed catalog).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `slug` | string UNIQUE | URL: `plomberie`, `coiffure`, `electricite` |
| `name_translations` | JSONB | E.g., `{"fr-CA": "Plomberie", "en-CA": "Plumbing"}` |
| `description_translations` | JSONB | |
| `icon_url` | string | |
| `regulation_level` | enum (`REGULATED`, `INFORMAL`) | **Cascades to all items in this category** |
| `is_active` | boolean | |
| `sort_order` | int | Admin-defined display order |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

#### `service_items` (Services)
**Specific services within a category**. Pros can suggest new ones, admins approve.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_category_id` | FK → service_categories | Parent category |
| `slug` | string | |
| `name_translations` | JSONB | |
| `description_translations` | JSONB | |
| `typical_duration_minutes` | int NULLABLE | Indicative |
| `suggested_price_range` | JSONB | E.g., `{"min": 50, "max": 150, "currency": "CAD"}`. Indicative only — providers set their own price |
| `suggested_by_user_id` | FK → users NULLABLE | If user-suggested |
| `approval_status` | enum (`PENDING`, `APPROVED`, `REJECTED`) | |
| `approved_at_utc`, `approved_by_user_id` | metadata | |
| `is_active` | boolean | |
| `sort_order` | int | |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

#### `regulatory_requirements`
Geo-scoped legal requirements for regulated categories. **This is the heart of the Feature Toggling for regulations.**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_category_id` | FK → service_categories | |
| `country_code` | ISO 3166-1 | E.g., `CA` |
| `subdivision_code` | ISO 3166-2 NULLABLE | NULL = country-wide |
| `authority_code` | string | E.g., `RBQ`, `CMEQ`, `CMMTQ`, `CCQ`, `ASP_CONSTRUCTION` |
| `authority_full_name_translations` | JSONB | |
| `validation_endpoint_url` | string NULLABLE | Public API for license verification |
| `required_document_type` | enum (`LICENSE_NUMBER`, `COMPETENCY_CARD`, `CERTIFICATION`) | |
| `is_required` | boolean | |
| `created_at_utc`, `updated_at_utc` | timestamps | |

**Example for Plomberie in Quebec:**
- One row: `country=CA, subdivision=CA-QC, authority=RBQ, doc=LICENSE_NUMBER, required=true`
- Second row: `country=CA, subdivision=CA-QC, authority=CMMTQ, doc=LICENSE_NUMBER, required=true`

### 5.5 Domain: Provider-Service Junction & Verifications

#### `professional_service_categories`
Records that a provider practices a specific category (Métier). One row per category per provider.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_provider_id` | FK → service_providers | |
| `service_category_id` | FK → service_categories | |
| `verification_status` | enum (`PENDING`, `VERIFIED`, `REJECTED`, `NOT_REQUIRED`) | |
| `requested_at_utc` | timestamp | |
| `verified_at_utc` | timestamp NULLABLE | |
| `rejection_reason` | text NULLABLE | |
| `is_active` | boolean | Provider can pause this category |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

**Constraints:** `UNIQUE(service_provider_id, service_category_id)`

**Business rule:** For `INFORMAL` categories, `verification_status` auto-sets to `NOT_REQUIRED`. For `REGULATED` categories, starts as `PENDING` until all required `regulatory_requirements` are satisfied by approved `verification_documents`.

#### `professional_services`
Specific services offered by a provider, within a verified category.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `professional_service_category_id` | FK | **Cascading verification:** if parent is not VERIFIED/NOT_REQUIRED, service is unavailable |
| `service_item_id` | FK → service_items | |
| `pricing_model` | enum (`FLAT`, `HOURLY`, `QUOTE_ONLY`) | |
| `price_amount` | decimal NULLABLE | NULL if `QUOTE_ONLY` |
| `price_currency` | ISO 4217 | |
| `estimated_duration_minutes` | int NULLABLE | |
| `description_override` | text NULLABLE | |
| `is_active` | boolean | |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

**Constraints:** `UNIQUE(professional_service_category_id, service_item_id)`

#### `verification_documents`
Proof documents uploaded by providers (e.g., RBQ license PDF, CMMTQ card, ASP Construction certificate).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `professional_service_category_id` | FK | Which category claim this satisfies |
| `regulatory_requirement_id` | FK → regulatory_requirements | Which specific requirement |
| `document_type` | enum (matches `required_document_type`) | |
| `document_number` | string NULLABLE | E.g., RBQ license number |
| `file_url` | string | Cloud storage (S3, R2, etc.) |
| `file_mime_type` | string | |
| `file_size_bytes` | int | |
| `issued_at_utc` | timestamp NULLABLE | Date issued by authority |
| `expires_at_utc` | timestamp NULLABLE | **Cron job revokes status when expired** |
| `review_status` | enum (`PENDING`, `APPROVED`, `REJECTED`) | |
| `reviewed_at_utc` | timestamp NULLABLE | |
| `reviewed_by_user_id` | FK → users NULLABLE | Admin reviewer |
| `rejection_reason` | text NULLABLE | |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

### 5.6 Domain: Service Requests & Quotes

#### `service_requests`
**Unified entity** for both direct bookings and project tenders, discriminated by `request_type`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_user_id` | FK → users | |
| `request_type` | enum (`DIRECT_BOOKING`, `PROJECT_TENDER`) | **Key discriminator** |
| `status` | enum (see state machine below) | |
| `service_category_id` | FK → service_categories | Always required |
| `service_item_id` | FK → service_items NULLABLE | NULL for open tenders |
| `assigned_service_provider_id` | FK → service_providers NULLABLE | Set when transitioning to `ASSIGNED` |
| `title` | string | |
| `description` | text | |
| `service_address` | string | Human-readable address |
| `service_location` | PostGIS Point | **GIST-indexed** for proximity queries |
| `desired_start_at_utc` | timestamp NULLABLE | Client's preferred start |
| `desired_end_at_utc` | timestamp NULLABLE | |
| `scheduled_at_utc` | timestamp NULLABLE | Confirmed appointment |
| `estimated_amount` | decimal NULLABLE | |
| `estimated_currency` | ISO 4217 | |
| `final_amount` | decimal NULLABLE | At completion |
| `final_currency` | ISO 4217 | |
| `response_deadline_utc` | timestamp NULLABLE | For DIRECT_BOOKING auto-expiration |
| `quotes_deadline_utc` | timestamp NULLABLE | For PROJECT_TENDER |
| `accepted_at_utc`, `completed_at_utc`, `paid_at_utc`, `cancelled_at_utc` | timestamps NULLABLE | Full audit trail |
| `cancellation_reason` | text NULLABLE | |
| `cancelled_by_user_id` | FK → users NULLABLE | |
| `created_at_utc`, `updated_at_utc`, `deleted_at_utc` | timestamps | |

**State Machine (Unified for both request_types):**

```
DRAFT → OPEN → ASSIGNED → IN_PROGRESS → COMPLETED → PAID
                  ↓             ↓              ↓
              EXPIRED      CANCELLED      REFUNDED (admin-forced)
              CANCELLED
```

Note: No `DISPUTED` state in MVP — disputes handled manually by admin via direct status forcing.

> **Implementation note (Phase 3.10c — balance release & contest):**
> - `service_requests.contested_at_utc` (timestamptz NULL) was added. The provider marking a job done lands the request in **`COMPLETED` = awaiting-release**; the balance is **NOT** captured at that moment. The `COMPLETED → PAID` transition is driven only by the BALANCE PaymentIntent succeeding (webhook, §9), itself triggered by either the client's **`POST service-requests/:id/confirm-completion`** or the hourly **auto-release cron** (after `PLATFORM_AUTO_RELEASE_HOURS`).
> - **`POST service-requests/:id/contest`** (client/owner only) stamps `contested_at_utc = now()` — there is **no dispute state machine**; this only **freezes** the auto-release timer and routes to admin. A contested request makes both confirm-completion and the cron **refuse/skip** the balance capture. `buildTransition` now stamps `paid_at_utc` on `COMPLETED → PAID` (mirroring `cancelled_at_utc`).

#### `quotes`
Pro responses to `PROJECT_TENDER` requests. Immutable once submitted (must `WITHDRAW` and resubmit to change).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_request_id` | FK → service_requests | |
| `service_provider_id` | FK → service_providers | |
| `amount` | decimal | |
| `currency` | ISO 4217 | |
| `estimated_duration_minutes` | int | |
| `proposed_start_at_utc` | timestamp NULLABLE | |
| `description` | text | Pro's pitch |
| `status` | enum (`SUBMITTED`, `WITHDRAWN`, `ACCEPTED`, `REJECTED`, `EXPIRED`) | `EXPIRED` ajouté en 3.9 — cron horaire sur `valid_until_utc` (déviation assumée vs spec d'origine) |
| `valid_until_utc` | timestamp | Quote expiration |
| `created_at_utc`, `updated_at_utc` | timestamps | |

**Constraints:** `UNIQUE(service_request_id, service_provider_id)` — One active quote per provider per request

**Business Rule:** When a quote transitions to `ACCEPTED`, the parent `service_request` transitions to `ASSIGNED`, `assigned_service_provider_id` is filled, and all sibling quotes auto-transition to `REJECTED`.

#### `service_request_attachments`
Photos/videos uploaded by client (and "Avant/Après" by Pro).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_request_id` | FK | |
| `file_url` | string | |
| `file_mime_type` | string | |
| `file_size_bytes` | int | |
| `caption` | text NULLABLE | |
| `uploaded_by_user_id` | FK → users | |
| `created_at_utc` | timestamp | |

#### `service_request_assignments`
**Worker dispatch**. For organizations: which specific worker executes the job. For individuals: a row pointing to themselves (created automatically) — unifies application logic.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_request_id` | FK | |
| `worker_user_id` | FK → users | Who executes |
| `assigned_by_user_id` | FK → users | Who dispatched (OWNER for orgs, self for individuals) |
| `status` | enum (`ASSIGNED`, `ACCEPTED_BY_WORKER`, `DECLINED_BY_WORKER`, `COMPLETED`) | |
| `assigned_at_utc` | timestamp | |
| `acknowledged_at_utc` | timestamp NULLABLE | |
| `completed_at_utc` | timestamp NULLABLE | |

### 5.7 Domain: Payments & Stripe Connect

#### `stripe_connect_accounts`
1:1 link between `service_providers` and their Stripe Connect Express account.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_provider_id` | FK UNIQUE → service_providers | |
| `stripe_account_id` | string UNIQUE | `acct_xxx` |
| `account_type` | enum (`EXPRESS`, `CUSTOM`) | `EXPRESS` for MVP |
| `onboarding_status` | enum (`NOT_STARTED`, `INFO_NEEDED`, `PENDING_VERIFICATION`, `VERIFIED`, `RESTRICTED`, `DISABLED`) | |
| `charges_enabled` | boolean | Synced from Stripe webhook |
| `payouts_enabled` | boolean | Synced from Stripe webhook |
| `requirements_currently_due` | JSONB | Snapshot of Stripe-side requirements |
| `country_code` | ISO 3166-1 | Stripe account registration country |
| `default_currency` | ISO 4217 | |
| `onboarded_at_utc` | timestamp NULLABLE | |
| `created_at_utc`, `updated_at_utc` | timestamps | |

> **Implementation note (Phase 3.10a — `stripe-connect` module):**
> - Onboarding uses **Stripe Account Links** (`type: 'account_onboarding'`), **not** Connect OAuth. `STRIPE_CONNECT_CLIENT_ID` is therefore **DORMANT** — kept in the env contract but unused by this flow.
> - Routes: `POST/GET service-providers/:id/connect/{onboard,status,refresh-link}` (JWT-guarded, INDIVIDUAL providers only — ORGANIZATION onboarding returns **501**, deferred).
> - `default_currency` is stored **UPPERCASE** (Stripe returns it lowercase; normalized on write). `onboarded_at_utc` is stamped **once**, on the first transition to `VERIFIED`, and never cleared.
> - The local row is kept in sync by the `account.updated` webhook (see §9). Two CHECK constraints enforce coherence: `VERIFIED ⇒ charges & payouts enabled`, and `NOT_STARTED ⇒ neither enabled`.

#### `payment_methods`
**Polymorphic ownership**: belongs to either a user (B2C client) or organization (B2B client paying for subscription).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `owner_user_id` | FK → users NULLABLE | |
| `owner_organization_id` | FK → organizations NULLABLE | |
| `stripe_payment_method_id` | string UNIQUE | `pm_xxx` |
| `type` | enum (`CARD`, `BANK_ACCOUNT`, `INTERAC_DEBIT`) | |
| `brand` | string NULLABLE | `VISA`, `MASTERCARD`, `AMEX` |
| `last4` | string | For UI display |
| `exp_month`, `exp_year` | int NULLABLE | For cards |
| `is_default` | boolean | |
| `created_at_utc`, `deleted_at_utc` | timestamps | |

**Constraints:** Exactly one of `owner_user_id` / `owner_organization_id` is non-null.

#### `payments`
Service payment transactions. **2 rows per `service_request` typically: one `DEPOSIT` + one `BALANCE`.**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_request_id` | FK → service_requests | |
| `payment_type` | enum (`DEPOSIT`, `BALANCE`, `SINGLE_PAYMENT`) | |
| `payer_user_id` | FK → users | The actual person clicking pay |
| `payer_organization_id` | FK → organizations NULLABLE | If a company pays for an employee |
| `recipient_service_provider_id` | FK → service_providers | |
| `payment_method_id` | FK → payment_methods | |
| `stripe_payment_intent_id` | string | |
| `status` | enum (`PENDING`, `PROCESSING`, `REQUIRES_ACTION`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED`) | Mirrors Stripe states |
| `gross_amount` | decimal | Amount charged to client |
| `currency` | ISO 4217 | |
| `commission_rate_percent` | decimal NULLABLE | **Snapshot at time of payment**. NULL for B2B (no commission). 10.00 for B2C. |
| `platform_fee_amount` | decimal | = gross × commission_rate / 100 |
| `tax_amount` | decimal | Taxes collected (TPS + TVQ for Quebec) |
| `provider_net_amount` | decimal | gross - platform_fee - taxes_remitted |
| `captured_at_utc` | timestamp NULLABLE | |
| `failed_at_utc` | timestamp NULLABLE | |
| `failure_reason` | text NULLABLE | |
| `created_at_utc`, `updated_at_utc` | timestamps | |

> **Implementation note (Phase 3.10b — `payments` module):**
> - `payment_methods` and `payments` are **modeled and live** (migration `CreatePaymentsDomain`). 3.10b scope is **user-owned** payment methods + the **DEPOSIT (20%)** capture only; org-owned methods, BALANCE capture, and refunds are deferred.
> - `users.stripe_customer_id` (varchar NULLABLE, partial-UNIQUE) was added: the Stripe Customer is created lazily on the user's first `POST payment-methods` and reused thereafter. Routes: `POST/GET payment-methods`, `POST payment-methods/:id/default`, `DELETE payment-methods/:id` (soft-delete + best-effort Stripe detach). First saved method auto-becomes the default; one default per owner is enforced by partial unique indexes.
> - **Assignment guards (payability):** inside the shared `assignIndividualProvider()` transaction, the OPEN→ASSIGNED transition is **blocked with 409** unless (a) the recipient provider's `stripe_connect_accounts.charges_enabled = true` AND (b) the client has a default, non-deleted payment method. A throw rolls the whole assignment back.
> - **Deposit basis rule:** quote-accept path → the **accepted `quote.amount/currency`**; direct-booking path → the **request's `estimated_amount/currency`** (422 if NULL). `deposit_gross = 20%` of the agreed amount, `platform_fee = 10%` of the deposit (commission snapshot), **`tax_amount = 0` for the MVP** (TPS/TVQ engine deferred), `provider_net = gross − fee − tax` (DB CHECK enforces the invariant). All money math goes through `src/common/money/` (integer minor units, HALF-UP) — inline `*100`/`/100` is forbidden.
> - **Capture:** runs **after** the assignment transaction commits — a Stripe destination charge (`transfer_data.destination` = provider's `acct_`, `application_fee_amount` = platform fee) confirmed **off-session** against the client's default `pm_`, with Stripe idempotency key `dep_<service_request_id>`. The local row is `UNIQUE(service_request_id, payment_type)`-guarded (one DEPOSIT per request; a second capture call short-circuits). Final status is synced by the `payment_intent.*` webhook worker (§9); a Stripe failure marks the row `FAILED` (+ reason) and surfaces a 502.
> - `payments` rows are **immutable history**: no `deleted_at_utc` (accepted, documented deviation from the soft-delete-everywhere rule).

#### `refunds`
Admin-initiated refunds only (no client self-service in MVP).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `payment_id` | FK → payments | |
| `amount` | decimal | Supports partial refunds |
| `currency` | ISO 4217 | |
| `reason` | text | |
| `initiated_by_user_id` | FK → users | Admin |
| `status` | enum (`PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED`) | |
| `stripe_refund_id` | string | |
| `created_at_utc`, `updated_at_utc` | timestamps | |

> **Implementation note (Phase 3.10c — `refunds` modeled + BALANCE capture):**
> - The `refunds` table is **modeled and live** (migration `CreateRefundsDomain`, head after 3.10b). Native enum `refund_status`; `CHECK (amount > 0)`; partial-unique `UNIQUE(stripe_refund_id)`; a `failure_reason` column was added; **no `deleted_at_utc`** (immutable history, same as `payments`). `currency` is stored UPPERCASE and must equal the parent `payments.currency` (service-enforced).
> - **BALANCE basis (immutable-quote):** `balance_gross = agreed_amount − deposit.gross_amount` so **`deposit + balance == agreed` exactly** (subtraction in integer minor units via `src/common/money/`). `agreed_amount` is the **same source the deposit used** — accepted `quote.amount` (tender) or `request.estimated_amount` (booking). `platform_fee = 10%` of the balance, `tax = 0`. The capture is a destination charge (`transfer_data.destination`, `application_fee_amount`) confirmed **off-session** with idempotency key `bal_<service_request_id>`, guarded by `UNIQUE(service_request_id, payment_type)` (one BALANCE per request). The payer/recipient/currency are re-read from the **DEPOSIT row**; the client's **current default** payment method is re-resolved at capture time.
> - **Admin refunds** (`POST admin/payments/:id/refund`, ADMIN-guarded; partial-capable). Anti-over-refund: `amount ≤ gross − Σ(refunds in PENDING/SUCCEEDED)` else **422**. The row is inserted PENDING (its id is the Stripe idempotency key `ref_<refund_id>`), then `stripe.refunds.create({ reverse_transfer: true, refund_application_fee: true })` reverses the transfer + application fee **pro-rata** on partials automatically. Payment status is then **derived** from settled refunds: `Σ(SUCCEEDED) == gross → REFUNDED`, `0 < Σ < gross → PARTIALLY_REFUNDED` (monotonic — never downgraded). Final settlement (and the request `→ REFUNDED` transition) is driven by the webhook (§9). PaymentsModule has **zero dependency** on the service-requests domain — all request-state transitions are driven by the webhook worker.

#### `payouts`
Stripe Connect transfers from platform → provider's bank account. Largely auto-managed by Stripe; we mirror for our own reconciliation dashboard.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `service_provider_id` | FK → service_providers | |
| `stripe_payout_id` | string UNIQUE | |
| `amount` | decimal | |
| `currency` | ISO 4217 | |
| `status` | enum (`PENDING`, `IN_TRANSIT`, `PAID`, `FAILED`, `CANCELLED`) | |
| `arrival_date_utc` | timestamp NULLABLE | |
| `created_at_utc`, `updated_at_utc` | timestamps | |

---

## 6. Deferred Schemas (Model When Needed)

The following domains are **not yet modeled** but expected to be added before their respective features are implemented:

1. **Invoicing & Tax Engine** (`invoices`, `invoice_line_items`, `tax_codes`, `tax_records`) — REQUIRED before going live with payments in Quebec (TPS/TVQ legal obligation)
2. **SaaS Subscriptions** (`subscription_plans`, `organization_subscriptions`) — REQUIRED before launching B2B onboarding
3. **Social Domain** (`reviews`, `endorsements`, `portfolio_items` / `gallery_images`) — REQUIRED for the "LinkedIn" identity differentiation
4. **Identity Documents** (`identity_documents`) — Largely covered by Stripe Connect Express KYC, but a dedicated table may be needed for documents beyond Stripe's scope
5. **User Certifications** (`user_certifications`) — Personal worker certifications (e.g., CCQ Compagnon card held by an individual within an organization)
6. **Messaging** (`conversations`, `messages`) — Pro ↔ Client communication during a request

### Technical Debt (tracked)

- **Tracking de `docker/data/`** — ~2100 fichiers suivis par git (DB pgAdmin, sessions). Le `.gitignore` racine ignore `/data/` (ancré à la racine) mais **pas** `docker/data/`. Fix : ajouter `docker/data/` au `.gitignore` puis `git rm -r --cached docker/data`.
- **Rotation refresh = usage unique** — l'API renouvelle le refresh à chaque appel. Risque de **course** (étroit) quand des `fetch` BFF parallèles authentifiés arriveront (la 2ᵉ requête expirée pourrait présenter un refresh **déjà consommé** → 401 → déconnexion parasite). À traiter (**verrou / dédup**) avant les proxies de données. **Contrepartie sécurité** : sans blacklist, un refresh compromis reste valide jusqu'à `exp` (7 j) et les anciens refresh ne sont **jamais** invalidés — à durcir (**révocation / blacklist**) lors d'une phase sécurité auth dédiée.
- **Endpoints auth confirmés depuis le source** — `POST /auth/refresh`, body `{ refreshToken }`, réponse `TokenPair { accessToken, refreshToken }`, **401** sur échec.
- **Typage JSONB free-form (`Record<string, never>`) — dette *traduction* résolue (fix `openapi`), dette *nullable* toujours ouverte** : un `@ApiProperty` de map JSONB **sans** `additionalProperties` génère `Record<string, never>` (inexploitable) côté `schema.d.ts`. **Tous les champs de traduction (`*Translations`) sont désormais annotés `additionalProperties: { type: 'string' }` → typés `Record<string, string>`** : d'abord `GET /service-providers/{id}/service-requests` (3.12a-back), puis les 5 DTO source restants — `CreateServiceCategoryDto`, `CreateServiceItemDto`, `SuggestServiceItemDto`, `CreateRegulatoryRequirementDto` (`services-catalog`) + `AdminVerificationQueueItemDto` (`verifications`) — dont les 3 DTO `Update` héritent mécaniquement via `PartialType` (13 occurrences `Record<string, never>` → `Record<string, string>` dans `schema.d.ts`). **Reste ouvert et distinct — dette *nullable*** : les maps/nullables dégradés en `Record<string, never>` (`| null` sans type concret) sur `ServiceRequestResponseDto`, `PaymentMethodResponseDto`, `RefundResponseDto`, `ServiceProviderResponseDto` (`businessName`/`headline`/`bio`/`activatedAtUtc`…), `caption`, etc., ainsi que le GeoJSON (`serviceBaseLocation`, `zonePolygon`, `serviceLocation`) — **non corrigés ici** ; les casts/mirrors front (`lib/providers/types.ts`…) restent conservés en attendant.

---

## 7. Quebec Compliance & Internationalization

### 7.1 Regulatory Bodies (Hard Trust validation)

| Code | Full Name | Scope |
|---|---|---|
| `RBQ` | Régie du bâtiment du Québec | Construction trades (plumbing, electrical, carpentry, etc.) |
| `CMEQ` | Corporation des maîtres électriciens du Québec | Electrical master license |
| `CMMTQ` | Corporation des maîtres mécaniciens en tuyauterie du Québec | Plumbing master license |
| `CCQ` | Commission de la construction du Québec | Worker competency cards (Apprenti / Compagnon) |
| `ASP_CONSTRUCTION` | Association paritaire pour la santé et la sécurité du travail | Construction site safety certification |

### 7.2 Taxes (Quebec)

- **TPS (federal)**: 5%
- **TVQ (provincial)**: 9.975%
- **Combined effective rate**: ~14.975% on most services
- Applied on **provider's revenue** (provider remits via their Stripe Connect account); Linkr platform fees may also be taxable separately
- ALL invoices generated by Linkr for Quebec transactions must be **Revenu Québec-compliant** (will be implemented in deferred Invoicing domain)

### 7.3 Loi 25 (Quebec Privacy Law) Compliance

- **Soft delete everywhere** (`deleted_at_utc`) — never hard DELETE personal data
- **Audit trail** on every state transition (`accepted_at_utc`, `completed_at_utc`, `reviewed_at_utc`, etc.)
- **Explicit consent** must be tracked for any non-essential data processing
- **Right to data portability** — implement a data export endpoint
- **Privacy Officer** designation (Person responsible) — to be assigned at org level

### 7.4 Internationalization (Day-1 Requirements)

- **All timestamps in UTC** with explicit `_utc` suffix
- **All amounts stored with ISO 4217 currency code**
- **All countries via ISO 3166-1**, subdivisions via ISO 3166-2
- **All translations in JSONB columns** (`name_translations`, `description_translations`) — no schema changes needed to add a language
- **BCP 47 locale codes** for `language_preference` (e.g., `fr-CA`, `en-CA`, `en-US`, `fr-FR`)
- **Phone numbers in E.164 format** (`+15145551234`)
- **Feature Toggling for regulations** — `regulatory_requirements` table drives behavior per `(country_code, subdivision_code)` tuple

### 7.5 Default Bilingual Setup (Quebec)

- Primary: `fr-CA`
- Secondary: `en-CA`
- All UI strings, all catalog entries, all email templates: bilingual from day 1

---

## 8. Authentication & Authorization

### 8.1 Authentication

**Multi-modal** via PassportJS:
- Email + Password (Argon2id hashing)
- Google OAuth 2.0
- Apple Sign-In (**mandatory on iOS** if any other OAuth is offered)

**Token strategy — stateless access/refresh pair (Phase 3.4):**
- **Access token**: short-lived (`JWT_ACCESS_EXPIRES_IN`, default `15m`), signed with `JWT_ACCESS_SECRET`, sent as `Authorization: Bearer`. This short TTL is intentional; a ~15 min expiry is expected, not a bug.
- **Refresh token**: long-lived (`JWT_REFRESH_EXPIRES_IN`, default `7d`), signed with a **distinct** `JWT_REFRESH_SECRET`.
- **Renewal**: `POST /auth/refresh` is `@Public()` and takes the refresh token in the body — it works with an **expired access token**, returning a fresh pair. Clients refresh transparently on a `401`.

**Progressive Identity Verification State Machine:**
```
NONE → EMAIL → PHONE → IDENTITY
```
- Phone verification (SMS OTP) required to activate Pro mode
- IDENTITY level reached after Stripe Connect Express KYC completion (triggered at first payment as Pro)

### 8.2 Authorization (RBAC)

**System-level roles** (on user):
- `USER` — Default; can be client and/or solo Pro
- `ADMIN` — Linkr staff; back-office access

**Organization-level roles** (on `organization_memberships`):
- `OWNER` — Full org control: billing, profile, dispatching, financial visibility
- `WORKER` — Restricted: sees only assigned jobs, addresses, mark-complete; NO financial visibility

**Permission Guards:** All endpoints protected by NestJS Guards. Composable via decorators (`@Roles('OWNER')`, `@RequireOrgMembership()`, etc.).

---

## 9. Async Tasks (Redis + Bull)

The following operations MUST be queued via **BullMQ** (never executed synchronously in HTTP handlers):

1. **Stripe webhooks** — Verify signature → enqueue → respond 200 OK to Stripe within 5 seconds. Process asynchronously.
2. **Email sending** — Transactional emails (booking confirmations, receipts, etc.)
3. **Push notifications** — To mobile clients
4. **License expiration check (Cron job, nightly)** — Scans `verification_documents` for `expires_at_utc < NOW()`. Marks expired docs as `EXPIRED`, downgrades parent `professional_service_category.verification_status` to `REJECTED`, notifies the provider.
5. **Quote deadline expiration (Cron job, hourly)** — Scans `service_requests.quotes_deadline_utc < NOW()` with status `OPEN` and transitions them to `EXPIRED` if no quote was accepted.
6. **Direct booking response deadline (Cron job, every 5 min)** — Scans `service_requests.response_deadline_utc < NOW()` with status `OPEN` and `request_type = DIRECT_BOOKING`, transitions to `EXPIRED`.
7. **Stripe Connect onboarding reminders** — For providers in `INFO_NEEDED` status > 48 hours.
8. **Balance auto-release (Cron job, hourly — 3.10c)** — Scans `service_requests` with `status = COMPLETED`, `contested_at_utc IS NULL`, `deleted_at_utc IS NULL`, and `completed_at_utc < now() − PLATFORM_AUTO_RELEASE_HOURS`, and **triggers** the 80% balance capture for each (idempotent via the BALANCE unique guard — never double-charges; webhook finalizes status). Per-request failures are logged and never abort the batch.

> **Implementation note (Phase 3.10c — balance-release & refund webhook events):** the `StripeWebhookProcessor` now also handles: `payment_intent.succeeded` for a **BALANCE** payment → after the forward-only `SUCCEEDED` sync, transition the parent request **`COMPLETED → PAID`** via `buildTransition` (stamping `paid_at_utc`); deposit success keeps its prior silent behavior (only BALANCE drives PAID). `charge.refunded` / `refund.updated` → look up the local refund by `stripe_refund_id`, advance it (forward-only from PENDING), recompute the parent payment status (REFUNDED / PARTIALLY_REFUNDED derivation), then transition the request **`→ REFUNDED`** iff **every** captured payment (status in `SUCCEEDED`/`PARTIALLY_REFUNDED`/`REFUNDED`) is now `REFUNDED` (a partial refund never changes request status; FAILED rows ignored). The request transitions live in the webhook worker (which imports both PaymentsModule and ServiceRequestsModule) so neither domain module depends on the other.

> **Implementation note (Phase 3.10b — async webhook pipeline; 3.10a debt paid):** `POST webhooks/stripe` now complies with rule 1. The controller (1) verifies the signature against the **raw** body (`rawBody: true` in `main.ts`), (2) enqueues `{ eventId, type, data }` to the BullMQ queue **`stripe-webhooks`**, (3) returns `200 { received: true }` immediately — no business processing in the handler. The worker (`StripeWebhookProcessor`, attempts: 5, exponential backoff) dispatches: `account.updated` → Connect mirror snapshot-overwrite; `payment_intent.succeeded` / `payment_intent.payment_failed` / `payment_intent.processing` → **forward-only** payment status updates (a terminal status — `SUCCEEDED`, `REFUNDED`, `CANCELLED`, `PARTIALLY_REFUNDED` — is never regressed by a late or replayed event). Unknown event types are logged and acked (no-op). A persistent event-id dedupe store is **deferred** — idempotency is structural for the handled events (snapshot overwrite + conditional UPDATEs).

---

## 10. Coding Standards

### 10.1 Naming Conventions

- **Tables**: snake_case, plural (`service_providers`, `professional_services`)
- **Columns**: snake_case (`created_at_utc`, `service_provider_id`)
- **TypeScript classes/interfaces**: PascalCase (`ServiceProvider`, `IUserRepository`)
- **TypeScript variables/functions**: camelCase (`serviceProvider`, `getUserById`)
- **NestJS modules**: PascalCase suffixed (`UsersModule`, `PaymentsModule`)
- **Files**: kebab-case (`service-provider.entity.ts`, `users.controller.ts`)
- **Env vars**: SCREAMING_SNAKE_CASE (`DATABASE_URL`, `STRIPE_SECRET_KEY`)

### 10.2 Mandatory Patterns

- **Repository Pattern** — All DB access via Repository classes; never in controllers or services directly
- **DTO validation** — Every endpoint input via `class-validator` DTOs
- **Custom exceptions** — Domain-specific exceptions (`ServiceProviderNotVerifiedException`, etc.) extending NestJS HttpException
- **Logger injection** — Use `@nestjs/common` Logger, never `console.log`
- **Transactional boundaries** — Use TypeORM `QueryRunner` for multi-table writes
- **Idempotency** — All payment/webhook endpoints must be idempotent (use `idempotency_key` header)

### 10.3 Git Commit Convention

Conventional Commits with scopes matching NestJS modules:

```
feat(users): add password reset endpoint
fix(payments): handle stripe webhook signature verification failure
chore(docker): bump postgres to 16.2
refactor(providers): extract polymorphic owner resolution to helper
test(quotes): add integration test for quote acceptance flow
docs(readme): document local setup steps
```

---

## 11. Implementation Roadmap (Phase 3)

Tasks should be executed sequentially. Each task must produce **something testable** before moving on.

> **État réel (juillet 2026) :** 3.1–3.9 + 3.10a-c (paiements) + 3.11a (scaffold web + client API, PR #16) + 3.11b-1/b-2 (BFF auth httpOnly cookies + proxy deny-by-default, PR #17/#18) mergés sur `main`. Numérotation exécutée (alignée sur la table §11) : **3.11 = portail web**, **3.12 = dashboard prestataire (web)**, **3.13 = boucle transactionnelle cliente** *(en cours)*, **3.14 = découverte / recherche geo**, **3.15 = mobile / Expo**. **3.11b-3** (refresh silencieux dans le proxy : R2 double-écriture + rotation du refresh token, fail-safe clear) mergé (PR #19). La 3.11b est complète. **3.11c-A** (console admin de revue des `verification_documents` : work queue PENDING + approve/reject via Route Handlers BFF, RBAC API-side, refresh via `router.refresh()`) livré sur la branche. Première page métier. **3.11c-A-bis** (backend) : endpoint file admin (`GET /admin/verification-documents`) enrichi des libellés joints — métier i18n (`serviceCategoryNameTranslations`) + `authorityCode` + `providerDisplayName` (résolu polymorphe ORG→`organization.displayName` / INDIVIDUAL→`businessName ?? prénom nom`) — via un DTO + mapper dédiés (`AdminVerificationQueueItemDto.fromWithLabels`, lecture `findByStatusWithRelations`). Isolation totale : `VerificationDocumentResponseDto.from()` global, `findByStatus()` et les autres endpoints (upload/list/approve/reject) **intacts** ; relation lecture-seule `ProfessionalServiceCategory→ServiceCategory` ajoutée sur la FK existante (`select:false` géo non touché — vérifié au runtime). OpenAPI + `schema.d.ts` régénérés (PR #21). **3.11c-A-ter** (front) : la console admin affiche désormais les libellés enrichis (métier i18n via `pickTranslation`, autorité, nom prestataire) au lieu des UUID bruts (conservés en `title` au survol). La console de vérification est **terminée et utilisable** (« 100 % humain »). Reste différé : le BFF file-proxy pour « Voir le fichier » (→ 401, candidat 3.11c-B). **3.12a-back** (backend) : nouvel endpoint `GET /service-providers/{id}/service-requests` — dashboard prestataire, **Vision B** (`assigned_service_provider_id = id` **OU** `requested_service_provider_id = id ET status = OPEN`), paginé. DTO dédié `ProviderServiceRequestItemDto` (libellés joints métier/service i18n + `clientDisplayName` ; **`serviceLocation` GPS et `clientUserId` exclus — Loi 25**), mapper `fromWithLabels`, chemin repo dédié `findAssignedOrTargetedToProvider` (SQL brut, **zéro colonne géo** : ni `service_location` ni `users.default_location` — ce dernier **non** `select:false` — donc aucun WKB lu) ; `toResponseDto`/`findAll`/`findById` **intacts**. **Garde** `loadOwnedProvider` (404/403) côté providers, listing délégué au domaine service-requests. **Anti-cycle (déviation §6 assumée)** : la route vit dans un contrôleur dédié `ProviderServiceRequestsController` **du module service-requests** (et non dans `ServiceProvidersController` — `ServiceProvidersModule` est un « sink » importé par notifications/payments→stripe-connect/quotes/verifications ; l'importer en retour cascade des cycles, **vérifié au boot**). Dépendance gardée **à sens unique** (`service-requests → service-providers`) : **zéro `forwardRef`, zéro cycle**, boot Nest OK. Dette typage JSONB corrigée à la source (`additionalProperties`) pour cet endpoint. OpenAPI + `schema.d.ts` régénérés. **Client soft-deleted masqué au mapper** `mapProviderRow` via projection `client_deleted_at_utc`, **pas** par filtre SQL : un filtre ferait disparaître un job assigné encore actif le prestataire doit le clôturer et désaccorderait `COUNT` de la requête principale ; libellés catégorie/item **non** masqués aucune saveur Loi 25. Validé runtime `:5000` : 2 branches Vision B, filtre `?status=OPEN`, i18n, **403** ownership alice ADMIN non-propriétaire, pagination COUNT-cohérente. **3.12a-back-bis** (backend) : nouvel endpoint `GET /service-providers/me` — résout « le provider du user courant » depuis le `sub` du JWT via `findByUserId` (déjà au repo `service-provider.repository.ts:136`, appelé en interne par `quotes.service` mais **jamais routé** jusqu'ici), pour que le dashboard prestataire (front) sache quel `{id}` mettre dans ses appels. Déclaré **AVANT** `GET /service-providers/:id` dans `ServiceProvidersController` (sinon `me` est avalé comme `:id` → `ParseUUIDPipe` 400). **Contrat de retour identique à `:id`** (même `ServiceProviderResponseDto` + `toResponse` — **zéro nouveau type**, `getMine` réutilise `findByUserId` qui **ne filtre pas `is_active`** et exclut les soft-deleted). **Inclut les providers `is_active = false`** (un prestataire en pause gère quand même son dashboard — sémantique **opposée** à `discover`). **404** (`NotFoundException`, **même chemin/exception que `:id`**) si le user n'a pas de provider. Auth = guard JWT global (pas de `@Public()`, comme `PATCH :id`), **owner-safe par construction** (dérivé du propre `sub`, aucun `:id` à vérifier → **pas de `loadOwnedProvider`**). Zéro migration (lecture seule). OpenAPI + `schema.d.ts` régénérés (le champ `ServiceProviderResponseDto` hérite du typage `Record<string, never>` sur ses maps/nullables — quirk JSONB free-form connu, non corrigé ici car le DTO est partagé avec `:id`). **3.12-front** (front) : **dashboard prestataire read-only à `/dashboard`** (remplace le stub d'atterrissage 3.11b-1 ; guard `getCurrentUser()` + `LogoutButton` préservés). Server Component : `GET /service-providers/me` (**404 → état vide sobre**, le CTA onboarding « Devenir prestataire » est **différé**) puis **Option A verrouillée : UN SEUL appel** `GET /service-providers/{id}/service-requests?limit=100` sans filtre `status` (les 2 branches Vision B sont disjointes) + **split côté serveur** : `status === 'OPEN'` → section « En attente de réponse » (inbox, en haut, accent ambre — revenue-opportunity time-sensitive) ; le reste → « Mes jobs » (badges de statut colorés, map exhaustive) — **pagination différée assumée**. i18n des libellés via `pickTranslation` (tender sans item → métier seul). **Compte à rebours statique** calculé au rendu serveur depuis `responseDeadlineUtc` (« Expire dans ~2 h 15 ») — **live-tick = fast-follow différé** (zéro `'use client'` dans la slice). **Piège de typage documenté** : l'OpenAPI déclare cette liste comme tableau plat (`isArray`) mais le runtime renvoie l'enveloppe `{items,total,page,limit}` → cast via miroirs locaux `lib/providers/types.ts` (même exception justifiée que `lib/auth/types.ts`) ; unions `status`/`requestType` **dérivées** du schéma généré. **Dette Loi 25 réaffirmée (choix produit délibéré, pas un oubli)** : `serviceAddress` complète affichée sur la carte « En attente » **AVANT** acceptation d'un booking OPEN multi-ciblable (pattern livraison : voir pour évaluer) — à statuer en phase B (bascule de l'adresse post-accept ?). « Voir le détail » → **stub** `/dashboard/requests/[id]` (id + mention Phase B, pas de 404) ; **vraie vue détail + actions Accepter/Refuser/Marquer complété = phase B, hors scope**. **3.12a-back-fix** (contrat) : le contrat de `GET /service-providers/{id}/service-requests` a été corrigé — l'annotation `@ApiResponse({ type: ProviderServiceRequestItemDto, isArray: true })` (tableau nu **mensonger**) est remplacée par un DTO d'enveloppe dédié `ProviderServiceRequestListDto` (`items`/`total`/`page`/`limit`), **spécifique à l'endpoint** (pas de générique `PaginatedResponseDto<T>` spéculatif — généralisation reportée à un vrai usage répété en phase B). La **logique du service est intacte** (le runtime renvoyait déjà l'enveloppe — c'était l'annotation qui mentait ; aucun changement de comportement). OpenAPI + `schema.d.ts` régénérés **en bootant l'app** (diff scopé : nouveau schéma + bascule de la réponse `array → $ref`, zéro champ collatéral). Côté front, le **« piège de typage » 3.12-front est résorbé** : le cast d'enveloppe au call-site (`data as unknown as ProviderServiceRequestList`) et le miroir local `ProviderServiceRequestList` sont **supprimés** (l'enveloppe est désormais typée nativement par le schéma généré) ; **seul** le cast **des items** subsiste (quirk JSONB/nullable `Record<string, never>` du DTO d'item — dette §6 distincte, non traitée ici). Dette de contrat #23 résorbée.

| Step | Task | Deliverable |
|---|---|---|
| 3.1 | Monorepo Foundation | `docker compose up` starts postgres+redis+pgadmin; `pnpm install` works at root |
| 3.2 | API Bootstrap | NestJS starts on port 3000; `GET /health` returns 200 with DB+Redis connection verified |
| 3.3 | Initial Migrations + Entities | TypeORM migrations create User domain tables (users, user_auth_providers); PostGIS extension enabled |
| 3.4 | Auth Module | Email/Password signup + login working; JWT issuance; Google + Apple OAuth flows |
| 3.5 | Users + Organizations Modules | CRUD endpoints; org membership management; role-based guards |
| 3.6 | Services Catalog Module | Admin CRUD for categories/items/requirements; Quebec seed data (RBQ, CMEQ, CMMTQ, CCQ) |
| 3.7 | Service Providers Module | Polymorphic provider creation; geo zones; verification documents upload (S3/R2) |
| 3.8 | Service Requests Module | Unified request state machine; geo matching for tender notifications |
| 3.9 | Quotes Module | Quote lifecycle (submit → accept → auto-assign, siblings rejected); hourly `EXPIRED` cron on `valid_until_utc` |
| 3.10 | Stripe Connect + Payments | Express onboarding (3.10a); deposit/balance capture (3.10b); refunds + balance auto-release (3.10c); async Stripe webhook pipeline |
| 3.11 | Bootstrap portail Web | Next.js + generated API client; BFF auth (httpOnly cookies, silent refresh); admin verification console |
| 3.12 | Dashboard prestataire (web) | Provider dashboard: read-only listing → transactional actions (accept / decline / start / complete) |
| 3.13 | Boucle transactionnelle cliente *(en cours)* | Client booking → deposit → confirm-completion / contest loop; shared `(app)` web shell |
| 3.14 | Découverte / recherche geo | Geo-based provider discovery & search (`ST_DWithin` radius + zone polygons) |
| 3.15 | Bootstrap Mobile / Expo | Expo app with auth flow; provider search screen using geolocation |
**3.12b-PR2-étape4** (front) : **composant `JobPipelineAction`** (`apps/web/src/app/dashboard/_actions/job-pipeline-action.tsx`) — quatrième et dernier composant d'action, **le SEUL sans `ConfirmDialog`**. Un composant unique piloté par le statut : ASSIGNED → « Démarrer » → `/start` ; IN_PROGRESS → « Compléter » → `/complete` ; tout autre statut → rend `null`. **Transitions financièrement INERTES** (le `complete` prestataire ne déclenche aucune capture Stripe — solde capturé plus tard par client/cron) et réversibles → **clic DIRECT sans dialogue**, juste `pending` (anti double-clic). `POST` sans corps, succès → `router.refresh()`. **Erreur INLINE sous le bouton** (`role="alert"`, pas de modale). **Mapping par statut HTTP seul** (verrouillé), vocabulaire « mandat » : 409 (« plus dans l'état attendu, la page va être actualisée »), 404 (« plus accessible »), fallback réseau/autre. **Comportement 409 spécifique** : affiche le message PUIS déclenche `router.refresh()` automatiquement (désync affichage↔base) ; 404/fallback affichent le message SANS refresh (succès refresh aussi). Pas de 502/422 (ni Stripe ni montant). `ConfirmDialog` NON touché. Validé : revue code (sélection statut, mapping byte-exact, refresh isolé au 409) + test navigateur (harnais comptant les appels refresh : succès+409 incrémentent, 404/500/réseau non ; COMPLETED rend null). Harnais jetable `app/_dev/job-pipeline-action`. **Les 4 composants d'action PR 2 sont désormais livrés** (ConfirmDialog + Accept + Decline + JobPipeline). **Reste PR 2** : câblage ⑥ dans `PendingRequestCard`/`JobCard` + **purge des 4 harnais `_dev`** (confirm-dialog, accept-action, decline-action, job-pipeline-action).
**3.12b-PR2-étape6a** (front, câblage) : **branchement des 4 composants d'action dans le dashboard réel** (`apps/web/src/app/dashboard/page.tsx`, Server Component `force-dynamic` — un Server Component rend directement les Client Components, aucun `'use client'` ajouté). Diff **purement additif** (+23 lignes, que des `+`, zéro ligne existante modifiée) : 3 imports, une rangée `flex flex-wrap gap-2` dans `PendingRequestCard` (`AcceptRequestAction` primaire avec les 6 props depuis `item` + `DeclineRequestAction` secondaire), et `JobPipelineAction` dans `JobCard` **posé sans condition** (self-null hors ASSIGNED/IN_PROGRESS → aucun `if` de statut dans la carte). `DetailLink` conservé et distinct dans les deux cartes (« décider » séparé de « consulter »). **Dette Loi 25 : statu quo assumé** — `serviceAddress` complète reste visible avant acceptation (décision produit ; la minimisation exigerait de décomposer ville/rue côté backend → tâche dédiée future, hors périmètre câblage). **Validé end-to-end sur stack Docker réelle** (le seul test non mocké de PR 2) : seed OPEN ciblé bob à 150,00 $ → clic « Accepter » → modale riche (montant total, **aucun % ni montant de dépôt affiché**) → BFF → API → **capture Stripe réelle** → webhooks tous `[200]` (`payment_intent.created/succeeded`, `charge.succeeded`, `transfer.created`, `application_fee.created`) → `router.refresh()` → la demande migre de « En attente » (5→4) vers « Mes jobs ». Base confirmée : `payments` = DEPOSIT / SUCCEEDED / **30,00 CAD** (20 % de 150) / commission 10 % / `platform_fee` **3,00** / `pi_` corrélé aux events. Self-nulling de `JobPipelineAction` vérifié en réel sur COMPLETED/PAID/REFUNDED (aucun bouton) et ASSIGNED (« Démarrer »). **Reste PR 2 : ⑥b — purge des 4 harnais `_dev`** (confirm-dialog, accept-action, decline-action, job-pipeline-action) dans une PR séparée dédiée.
**3.12b-PR2-étape6b** (chore) : **purge des 4 harnais `_dev` jetables** (`app/_dev/{confirm-dialog,accept-action,decline-action,job-pipeline-action}`, dossier disque `%5Fdev` supprimé). Ils avaient servi à valider chaque composant isolément (chemins d'erreur mockés : 409/502/404/réseau, garde montant `null`, self-nulling par statut) **avant** l'existence du dashboard transactionnel réel. Une fois le câblage 6a validé end-to-end sur stack Docker (capture Stripe réelle), ces bancs de test n'avaient plus de raison d'être dans `main` — décision assumée (purge totale) plutôt qu'une conservation « au cas où » sous garde `NODE_ENV`, qui aurait laissé du code non-production. Les tables de mapping d'erreurs restent documentées dans les entrées 6a et dans le code des composants. Build `apps/web` vert après suppression : aucune référence orpheline (les harnais consommaient les composants, jamais l'inverse). **PR 2 (dashboard transactionnel prestataire) est COMPLÈTE** : BFF relais (#29) + ConfirmDialog (#30) + Accept (#31) + Decline (#32) + JobPipeline (#33) + câblage (#34) + purge (#35).
**3.13 — Décisions shell (verrouillées)** : le portail web adopte **un seul shell partagé** à **navigation conditionnelle au rôle** (pas deux coquilles distinctes client/prestataire). **Atterrissage post-login = hub client par défaut** (le prestataire rejoint son dashboard via la nav, pas par une redirection d'accueil dédiée). Matérialisation par **route groups** Next : `(auth)` = surface de connexion, **hors** nav partagée ; `(app)` = **shell authentifié partagé** (dashboard prestataire + console admin aujourd'hui, nav rôle-conditionnelle à venir) ; **`app/api/**` reste HORS groupe** (route handlers BFF). Les route groups sont **URL-transparents** (zéro segment ajouté) → aucune route ne bouge.
**3.13-PR1** (refactor web) : **restructuration de `apps/web/src/app` en route groups à comportement STRICTEMENT préservé** (aucune URL, aucun rendu ne change ; refactor pur + doc, zéro nouvelle feature). `git mv` (historique conservé) : `login/` → `(auth)/login/` ; `dashboard/` **sous-arbre entier** (`_actions/` accept/decline/pipeline, cartes `PendingRequestCard`/`JobCard`, `requests/[id]`, `logout-button`) → `(app)/dashboard/` ; `admin/` (→ `verifications/`) → `(app)/admin/`. **Restent à la racine, intacts** : `layout.tsx` (**seul** porteur de `<html>`/`<body>` + `globals.css`), `page.tsx` (smoke `/health` qui sert `/`), `favicon.ico`, et **`app/api/**`** (BFF). Deux **layouts de groupe neutres** ajoutés (`(auth)/layout.tsx`, `(app)/layout.tsx`) : **pass-through strict** (`return children` ; zéro `<html>`/`<body>`/provider/markup/`'use client'`) — un **seul** root layout conservé, donc pas de multi-root-layout (aucun full-reload inter-groupe, aucun double document). **Zéro import à réparer** : aucun `@/app/…` dans le code ; les fichiers déplacés n'importent que `@/lib`/`@/components` (hors `app/`, alias inchangé) + des relatifs **intra-sous-arbre** qui suivent le bloc ; les URL en dur (`/dashboard`, `/login`, `/dashboard/requests/{id}`) sont invariantes aux route groups ; `proxy.ts` (le middleware **renommé** en Next 16, hors `app/`) garde ses `PUBLIC_PAGES = ['/', '/login']` + matcher **URL-based** inchangés. Validé : `pnpm --filter @linkr/web build` **vert** (une collision de routes ferait échouer le build = bon signal ; ici `(auth)/login`→`/login`, `(app)/dashboard`→`/dashboard`, disjoints). **Smoke runtime = humain** (sandbox sans stack Docker/API). Première PR de la phase 3.13 (fondation du shell).
**3.13-PR2** (front, la coquille prend vie) : **helper de capacités + nav conditionnelle + hub client**, additif, **web only**. **Helper serveur** `lib/nav/capabilities.ts` → `getShellCapabilities()` résout `{ user, isProvider }` : `user` via `getCurrentUser()` ; `isProvider` via `GET /service-providers/me` — **réutilise le pattern EXACT du dashboard** (même `getServerApiClient`), **200 = true, 404 = false** (un 404 n'est PAS une erreur : l'user n'a jamais activé le mode Pro) ; **défensif** : 5xx/réseau/throw → `false`, la nav dégrade **sans jamais casser la page**. **PAS de capacité `isAdmin` — et POURQUOI** : le JWT ne porte que `{ sub, email, type }`, le rôle admin n'est **jamais** exposé au front (**périmètre A assumé**, verrouillé) ; `/admin/verifications` reste atteignable **par URL** et gardé **API-side (403)** ; **zéro plomberie de rôle** (aucun champ rôle ajouté au JWT/DTO/session). **Nav conditionnelle** : `(app)/layout.tsx` devient un **Server Component async** (aucun `'use client'`) qui lit le helper **UNE FOIS** et rend `<Nav isProvider>` + `{children}` ; si `user === null` (théorique — `proxy.ts` redirige avant) → rend `{children}` **sans nav**, sans crash. `<Nav>` (Server Component présentationnel `(app)/nav.tsx`, `isProvider` **en prop** — pas de fetch propre) : liens **CLIENT toujours présents** (« Trouver un pro » → `/providers`, « Mes demandes » → `/requests`), lien **PRESTATAIRE si `isProvider`** (« Mon tableau de bord » → `/dashboard`), marque « Linkr » → `/`, `<LogoutButton>` à droite. **Hub client à `/`** : `app/page.tsx` racine (smoke `/health`, **obsolète** depuis 3.11a) **supprimé** ; nouveau `app/(app)/page.tsx` (Server Component sobre) — accueil « Bonjour, <prénom> » (`user.firstName`, **aucun champ inventé**), deux entrées `/providers` + `/requests`, raccourci discret `/dashboard` si `isProvider`. **AUCUNE** liste/recherche/appel geo (→ 3.14). **Logout déplacé (pas dupliqué)** : `logout-button.tsx` **`git mv`** `dashboard/` → `(app)/` (historique préservé, composant **non réécrit**), retiré du header de `(app)/dashboard/page.tsx` (sinon 2 boutons identiques). **Auth** : `proxy.ts` — `/` **retiré de `PUBLIC_PAGES`** (→ `['/login']` ; diff **chirurgical**, `deny-by-default` **non** refactoré) → `/` devient **privée** ; **redirection post-login** `(auth)/login/page.tsx` `router.push('/dashboard')` → **`router.push('/')`** (le **seul** point client ; le BFF `POST /api/auth/login` ne redirige pas). **Stubs sobres** `app/(app)/{providers,requests}/page.tsx` (« Bientôt disponible », phase 3.13 tâches 2 & 4) — pour que la nav soit testable de bout en bout, **remplacés** (pas créés) par les tâches suivantes ; `/requests` (**cliente**) **distincte** du stub prestataire `/dashboard/requests/[id]`. **Dette assumée** : **DOUBLE appel** à `/service-providers/me` sur `/dashboard` (layout via helper **+** page) — et de même sur `/` (layout **+** hub) — **acceptable en MVP, factorisation différée** (candidate `react/cache` request-mémoïsation). Validé : `pnpm --filter @linkr/web` **typecheck + build + lint verts** (une seule route `/`, aucune collision) ; **smoke runtime = humain** (sandbox sans Docker/API).
---

## 12. Environment Variables (Mandatory at Boot)

Each app MUST validate these via Joi/Zod schema at startup. Missing or malformed = crash immediately.

### API (`apps/api/.env`)

```
NODE_ENV=development|production
PORT=5000

DATABASE_URL=postgresql://user:password@host:5432/linkr
REDIS_URL=redis://host:6379

# JWT — stateless access/refresh token pair (distinct secrets, required)
JWT_ACCESS_SECRET=...
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=...
JWT_REFRESH_EXPIRES_IN=7d

GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
APPLE_OAUTH_CLIENT_ID=...
APPLE_OAUTH_TEAM_ID=...
APPLE_OAUTH_KEY_ID=...
APPLE_OAUTH_PRIVATE_KEY=...

STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

STORAGE_DRIVER=local            # local | s3 (default local)
STORAGE_LOCAL_DIR=./storage/uploads
# Required when STORAGE_DRIVER=s3 (AWS S3 ca-central-1 or Cloudflare R2):
STORAGE_BUCKET=linkr-uploads
STORAGE_REGION=ca-central-1
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_ENDPOINT=               # optional — custom endpoint for S3-compatible (R2)

PLATFORM_COMMISSION_RATE_PERCENT=10.00
PLATFORM_DEPOSIT_RATE_PERCENT=20.00
PLATFORM_DEFAULT_CURRENCY=CAD
PLATFORM_DEFAULT_COUNTRY_CODE=CA
PLATFORM_DEFAULT_SUBDIVISION_CODE=CA-QC
PLATFORM_DEFAULT_LOCALE=fr-CA

SENTRY_DSN=...
LOG_LEVEL=info|debug
```

### Web (`apps/web/.env.local`)

```
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
```

### Mobile (`apps/mobile/.env`)

```
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=...
```

---

## 13. Critical Reminders for the AI Coding Agent

1. **NEVER hard DELETE** rows — always soft delete via `deleted_at_utc`.
2. **NEVER store amounts without currency**. Always pair `*_amount` with `*_currency`.
3. **NEVER store timestamps without UTC**. All datetime columns have `_utc` suffix.
4. **NEVER bypass the Repository Pattern** — DB access only through repositories.
5. **NEVER reference `professional_profiles`** — that table was renamed to `service_providers` (polymorphic).
6. **NEVER assume a Pro is just a user** — always go through `service_providers` (which can wrap either a user or an organization).
7. **NEVER process Stripe webhooks synchronously** — enqueue to Bull, respond 200 immediately, process async.
8. **NEVER duplicate translations in separate columns** — use JSONB `name_translations` etc.
9. **NEVER skip env var validation** at boot.
10. **ALWAYS think about Quebec FIRST**, but design data structures so that another country/subdivision can be added without schema changes (Feature Toggling via `regulatory_requirements`, `tax_codes` rows).

---

## 14. Out-of-Scope (For Reference)

The following are EXPLICITLY out of scope for the MVP and should be deferred:

- Real-time dispute resolution center (admin-forced refunds only)
- Multiple roles in organizations beyond OWNER/WORKER (no MANAGER, ACCOUNTANT, etc.)
- Internal organization payroll (orgs handle worker payment externally)
- Multiple service radii per provider (only one primary radius + named zones)
- 3D AR features
- Public REST API for third-party integrations (will come post-MVP)
- Native iOS/Android (Expo is the chosen stack)

---

## 15. Glossary

| Term | Definition |
|---|---|
| **Hard Trust** | Trust badge backed by government-verified license (RBQ, CMEQ, etc.) |
| **Social Trust** | Trust badge backed by identity verification + community reviews |
| **Métier** | French/Quebec term for "trade" or "occupation category" (`service_categories`) |
| **Service Item** | Specific service within a Métier (e.g., "Déboucher un évier" within "Plomberie") |
| **Service Provider** | Polymorphic commercial entity (individual user OR organization) that sells services |
| **OWNER / WORKER** | Roles within an organization (B2B) |
| **DIRECT_BOOKING** | Client books a specific Pro directly for a specific service (Uber-style) |
| **PROJECT_TENDER** | Client posts a project, multiple Pros submit quotes (LinkedIn-style) |
| **DEPOSIT / BALANCE** | The two payments per typical service request (20% / 80%) |
| **CCQ Compagnon** | Quebec construction worker certification (journeyman) |
| **RBQ** | Quebec Building Authority — issues construction licenses |
| **Loi 25** | Quebec's privacy law (equivalent to GDPR) |
| **TPS / TVQ** | Quebec sales taxes (federal + provincial) |

---

**END OF BRIEF.** Implementation should follow the roadmap in Section 11, with each step validated before proceeding.
