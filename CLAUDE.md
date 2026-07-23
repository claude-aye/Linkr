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
- **BFF = mutations, plus les lectures déclenchées en cours de saisie qu'aucune navigation ne peut porter** (affiné en 3.14c-2 — la règle « BFF = mutations seulement » n'est pas cassée, elle est précisée). *Test d'admissibilité d'un GET BFF :* un `router.push` peut-il porter cette lecture sans détruire d'état utilisateur ? **Oui** → joint URL + Server Component (voies Ⓒ / Ⓒ′). **Non** → route handler légitime. Premier et seul cas à ce jour : `GET /api/geocode` (3.14c-2 — le formulaire de demande géocode l'adresse saisie au submit ; un `router.push` détruirait le formulaire à moitié rempli).
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
- **Typage JSONB free-form (`Record<string, never>`) — dette *traduction* résolue (fix `openapi`), dette *nullable* toujours ouverte** : un `@ApiProperty` de map JSONB **sans** `additionalProperties` génère `Record<string, never>` (inexploitable) côté `schema.d.ts`. **Tous les champs de traduction (`*Translations`) sont désormais annotés `additionalProperties: { type: 'string' }` → typés `Record<string, string>`** : d'abord `GET /service-providers/{id}/service-requests` (3.12a-back), puis les 5 DTO source restants — `CreateServiceCategoryDto`, `CreateServiceItemDto`, `SuggestServiceItemDto`, `CreateRegulatoryRequirementDto` (`services-catalog`) + `AdminVerificationQueueItemDto` (`verifications`) — dont les 3 DTO `Update` héritent mécaniquement via `PartialType` (13 occurrences `Record<string, never>` → `Record<string, string>` dans `schema.d.ts`). **Reste ouvert et distinct — dette *nullable*** : les maps/nullables dégradés en `Record<string, never>` (`| null` sans type concret) sur `ServiceRequestResponseDto`, `PaymentMethodResponseDto`, `RefundResponseDto`, `ServiceProviderResponseDto` (`businessName`/`headline`/`bio`/`activatedAtUtc`…), `caption`, etc., ainsi que le GeoJSON (`serviceBaseLocation`, `zonePolygon`, `serviceLocation`) — **non corrigés ici** ; les casts/mirrors front (`lib/providers/types.ts`…) restent conservés en attendant. **Ajout 3.14a — dette *contrat* symétrique à #23/3.12a/3.13-A** : `GET /service-providers/discover` est **annoté tableau nu** `DiscoveredProviderDto[]` alors que le runtime renvoie l'**enveloppe** `{items,total,page,limit}` (l'annotation ment) → miroir front `lib/providers/discovery-types.ts` (`DiscoveredProviderList`) + cast `as unknown as`. **Fix backend futur** : DTO d'enveloppe dédié `DiscoveredProviderListDto` (`@ApiOkResponse({ type })`, patron 3.12a-back-fix), après quoi supprimer le miroir + cast front. En sus, les 2 nullables `displayName`/`headline` de l'item dégradent en `Record<string, never>` (dette *nullable* ci-dessus) → re-typés chirurgicalement `string | null` dans le même miroir.
- **Découverte géo (3.14a) — dettes de suivi** : (1) **pagination différée** sur `/recherche` (`page=1&limit=50`, **un seul appel**, aucune UI de pagination — même dette que le dashboard prestataire et `/requests`) — **toujours ouverte**, s'étend à la branche geocode 3.14b-front (`/geocode?limit=5`, un seul appel, aucune UI de « plus de candidats ») ; (2) **géocodage d'adresse** (champ adresse → coords) — **LIVRÉ en 3.14b-front** (champ adresse sur `/recherche` → `GET /geocode` → liste de candidats désambiguïsée → clic candidat = `discover`) ; **threading des vraies coords → happy path LIVRÉ en 3.14c-1** (chaîne à 3 maillons URL : carte résultat → profil → formulaire de demande ; `create-request-form.tsx` construit désormais `serviceLocation = [lng, lat]` depuis les coords de l'URL — placeholder Québec **mort sur le happy path recherche→réservation**) ; **reste 3.14c-2** : le placeholder **survit sur l'edge profil-direct** (lien partagé sans coords, submit non bloqué) → **capture in-form / fallback checkout** (réutilisera la couture géoloc + `/geocode`) ; (3) **découverte publique/anonyme** = chantier futur distinct (rendre `discover` `@Public()` + rate-limit ; aujourd'hui **JWT requis**, `/recherche` est **privée** sous `(app)`).
- **Géocodage (3.14b-back) — dettes de suivi** : la couture `GET /geocode` (proxy Nominatim, port/adapter `common/geocoding/`) est **livrée** ; restent différés — (1) **cache Redis** du géocodage (recommandé par le ToS Nominatim ; différé car volume MVP faible, le `User-Agent` correct suffit à ce volume) — **toujours ouverte** ; (2) **rate-limiter** sur `/geocode` (Nominatim ≈ 1 req/s) — **toujours ouverte** ; (3) **2ᵉ adapter** (Mapbox/Google) prêt à brancher derrière la couture via `GEOCODING_PROVIDER` si volume/autocomplete l'exigent (jamais un rewrite) ; (4) **3.14b-front — RÉSOLU** : le navigateur atteint `/geocode` via **Voie Ⓒ′** (le token restant httpOnly server-side) — le Client Component **écrit `?q=&categoryId=` dans l'URL**, le Server Component lit `searchParams` + cookie et appelle `/geocode` **serveur-side** ; **AUCUN route handler BFF GET, AUCUNE Server Action** (règle maintenue : BFF = mutations seulement ; même patron que la voie Ⓒ de 3.14a). **3.14c-1 — happy path RÉSOLU** : le threading des vraies coords dans la création de demande est livré (chaîne à 3 maillons URL ; `create-request-form.tsx` construit `serviceLocation = [lng, lat]` depuis les coords URL) ; **reste 3.14c-2** — capture in-form pour l'edge profil-direct, cf. bullet 3.14a item (2) ci-dessus.
- **Placeholder `serviceLocation` (3.14c-1) — dette *partiellement* soldée** : le point Québec fixe `[-71.21, 46.81]` de `create-request-form.tsx` est **mort sur le happy path** (recherche → réservation) — les vraies coords cherchées voyagent désormais par l'URL (voie Ⓐ, chaîne à 3 maillons : `provider-card.tsx` → `providers/[id]/page.tsx` → `requests/new/{page,create-request-form}.tsx`), assemblées en GeoJSON `[lng, lat]` (⚠️ **longitude d'abord**). Il **survit sciemment sur l'edge profil-direct** (entrée directe sur `/providers/{id}` sans `?lat=&lng=`, ex. lien partagé Facebook) : le form **retombe** sur le placeholder plutôt que **bloquer le submit** (préserve le Direct Profile Sharing, levier d'acquisition), balisé `// TODO 3.14c-2`. **Reste 3.14c-2** : capture in-form (champ adresse/géoloc dans le form de demande, réutilisant la couture géoloc + `/geocode` de 3.14b) pour tuer le placeholder sur cet edge aussi. Le **cast `as unknown as …`** sur le GeoJSON (quirk *nullable* JSONB §6) **reste** dans les deux branches — non soldé ici.
- **État E « refus de géoloc » (3.14a) — dette SOLDÉE (3.14b-front)** : en 3.14a, un refus de géolocalisation affichait la bannière « Autorisez la géolocalisation… » **par-dessus des résultats serveur périmés** (les `searchParams` restaient peuplés → cartes/candidats d'une recherche précédente encore visibles sous la bannière = incohérent). **Correctif livré** : le chemin d'échec géoloc (`failGeo()` dans `search-form.tsx`) fait désormais `router.push('/recherche?categoryId=<id>')` (**repli sur ÉTAT 0 en conservant le métier**) **puis** lève la bannière (état client, survit à la soft-nav car l'îlot est préservé) → **plus aucun résultat périmé** ne subsiste. Le message et le bouton « Réessayer » sont inchangés ; **pas** de promesse « recherche par adresse » (le champ adresse dédié est désormais visible juste au-dessus comme alternative).
- **Nav — rationaliser « Trouver un pro » (`/providers`) vs « Rechercher » (`/recherche`)** (dette ouverte, hors périmètre 3.14b-front) : deux entrées de nav pointent vers des surfaces de découverte proches (`/providers` = stub découverte différé, `/recherche` = recherche géo réelle). À arbitrer/fusionner dans une tâche dédiée ; **délibérément non touché ici** (anti-objectif 3.14b-front).

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
**3.13-2a-back** (backend, contrat) : **enrichissement du contrat de `@Public() GET /service-providers/{providerId}/services`** pour le rendre réellement consommable par un client (la page publique de profil prestataire — tâche 2, front — doit nommer chaque service réservable et câbler son CTA « Demander » vers `POST /service-requests`). **LE POURQUOI / LE PIÈGE À DOCUMENTER NOIR SUR BLANC** : `CreateServiceRequestDto` exige `serviceCategoryId` (**REQUIS**, `@IsUUID`, non dérivé de l'item) ; or l'ancien `ProfessionalServiceResponseDto` exposait `professionalServiceCategoryId` = l'ID de la ligne de **JONCTION** `professional_service_categories` (**PAS** l'ID du métier au catalogue) **et aucun libellé** → le front ne pouvait ni nommer un service ni construire son payload. **Recette éprouvée deux fois réutilisée** (3.11c-A-bis file admin + 3.12a-back dashboard prestataire) : **DTO dédié + mapper `fromWithLabels` + chemin repo joint**, DTO global **INTACT**. **Nouveau DTO** `ProviderServiceCatalogItemDto` (réponse de **cet endpoint SEUL**) : `id`, `serviceItemId`, **`serviceCategoryId` (AJOUT CLÉ = `service_categories.id`, résolu via `service_items.service_category_id` — ⚠️ ≠ `professionalServiceCategoryId`)**, **`serviceItemNameTranslations` + `serviceCategoryNameTranslations` (AJOUT, maps i18n)**, `pricingModel`, `priceAmount`, `priceCurrency`, `estimatedDurationMinutes`, `descriptionOverride`. **RETIRÉS** de la réponse publique (bruit sans usage client) : `professionalServiceCategoryId` (ID de jonction interne), `isActive` (déjà un **filtre** côté serveur), `createdAtUtc`, `updatedAtUtc`. **Les 2 maps annotées `additionalProperties: { type: 'string' }`** → typées `Record<string, string>` dans `schema.d.ts` (on ne recrée PAS la dette `Record<string, never>` ; les nullables `priceAmount`/`estimatedDurationMinutes`/`descriptionOverride` peuvent hériter du quirk connu — dette §6 distincte, non traitée). **AUCUN champ de confiance** (ni `regulationLevel`, ni `verificationStatus`, ni badge) — décision produit **verrouillée** (badge différé). **Chemin repo dédié** `ProfessionalServiceRepository.findPublicCatalogByProviderId` (query builder, joint `service_items` + `service_categories` pour projeter `serviceCategoryId` + les 2 maps) : **le prédicat de visibilité est copié VERBATIM** du `findPublicByProviderId` adjacent (`ps.is_active` + `ps.deleted_at_utc IS NULL` + `psc.is_active` + `psc.deleted_at_utc IS NULL` + `psc.verification_status IN (VERIFIED, NOT_REQUIRED)` + `sp.is_active` + `sp.deleted_at_utc IS NULL`, `ORDER BY ps.created_at_utc ASC`) — **INVARIANT DE SÉCURITÉ** : un service dont la catégorie n'est pas VERIFIED/NOT_REQUIRED ne doit JAMAIS apparaître (contournement de la cascade de confiance = un métier réglementé non vérifié deviendrait réservable). **Les joins `service_items`/`service_categories` sont label-only** (égalité sur la FK, **sans** filtre `deleted_at_utc`/`is_active`) → **result set STRICTEMENT IDENTIQUE** (FK `RESTRICT` garantit l'existence des deux lignes). **Zéro colonne géo** lue. Chemins existants (`findById`/`findPublicByProviderId`/`findAllByProviderId`/`existsActive`/`create`/`update`/`softDelete`) **INTACTS** ; `ProfessionalServiceResponseDto.from()` global **INTACT** (toujours utilisé par create/update/`GET /services/owner`). **`GET /services/owner` STRICTEMENT INTACT** (contrat, DTO, comportement — vue prestataire). **Annotation honnête** : `@ApiOkResponse({ type: ProviderServiceCatalogItemDto, isArray: true })` — **forme runtime = tableau nu préservée** (leçon dette #23 : pas d'annotation mensongère). **Anti-cycle** : jointure **au niveau repository** ; `ServiceProvidersModule` importe **déjà** `ServicesCatalogModule` (le service utilise déjà `ServiceCategoryRepository`/`ServiceItemRepository`) → **zéro nouvel import de module, zéro `forwardRef`**. **Zéro migration** (lecture seule). **Consommateurs vérifiés** : seuls `openapi.json` + `packages/api-client/src/schema.d.ts` (générés) référencent l'endpoint — **aucun consommateur `apps/web`** → le retrait de champs n'est pas un breaking change à arbitrer. **STATUT RÉGÉN. OPENAPI = À FAIRE PAR L'HUMAIN** : le sandbox n'a NI Docker NI Postgres NI Redis ; `pnpm --filter @linkr/api openapi:generate` **boote l'app réelle** et échoue sur `ECONNREFUSED 127.0.0.1:6379` (Redis) — conformément à la consigne, **`openapi.json` et `schema.d.ts` laissés INCHANGÉS** (jamais édités à la main). L'humain régénère sur la branche avant merge : `pnpm --filter @linkr/api openapi:generate` puis `pnpm --filter @linkr/api-client codegen`. Validé : `pnpm --filter @linkr/api build` **vert** (typecheck OK) ; ESLint = dette flat-config pré-existante (non touchée). **Utilisateur de test ajouté** : `carol@linkr.test` / `Password123!` (id `24d8e824-1952-498d-acd0-a697c5b11207`) — **premier user PUREMENT CLIENT** (aucun provider → **404** sur `/service-providers/me`), utile pour tester la branche non-prestataire que ni alice ni bob ne couvrent.
**3.13-2-front** (front, la page qui fait NAÎTRE les IDs) : **page publique de profil prestataire `app/(app)/providers/[id]/page.tsx`** — identité + catalogue de services réservables, chaque service portant un CTA « Demander ». **C'est la SOURCE HONNÊTE DES IDENTIFIANTS** que le formulaire de création (tâche 3) exige (`serviceCategoryId` REQUIS + `serviceItemId` + `requestedServiceProviderId`) : aujourd'hui ces IDs ne naissaient que d'`INSERT` SQL manuels, désormais **d'un VRAI CLIC**. **Server Component, ZÉRO `'use client'`** dans la slice (le CTA est un `<Link>`, aucune interactivité) ; `force-dynamic`. **Deux appels serveur** via `getServerApiClient()` (pattern EXACT du dashboard) : `GET /service-providers/{id}` (identité) puis `GET /service-providers/{providerId}/services` (catalogue). **Page PRIVÉE** sous `(app)` (hérite de la nav partagée) **malgré des endpoints `@Public()`** → **garde `getCurrentUser()` conservée** (sans elle, une session expirée rendrait quand même la page puisque l'API publique répond 200 ; SEO public = décision 3.14). **`proxy.ts`/`PUBLIC_PAGES` NON touchés.** **Typage** : `GET /service-providers/{id}` = `ServiceProviderResponseDto` (objet), dette nullable §6 CONNUE (`businessName`/`headline`/`bio`/`activatedAtUtc` → `Record<string, never>`) → **réutilise le miroir local `ProviderProfile`** de `lib/providers/types.ts` + cast (exception déjà justifiée 3.12-front, non corrigée backend). `GET .../services` = **tableau NU** `ProviderServiceCatalogItemDto[]` (vérifié au SCHÉMA généré, ligne 3146 — **pas** d'enveloppe ; leçon dette #23). **Signalé (Étape 1) — le réel nuance « DTO propre »** : les **2 maps i18n** sont bien natives (`Record<string, string>`, `additionalProperties`) et consommées SANS miroir ; **mais** les 3 nullables scalaires `priceAmount`/`estimatedDurationMinutes`/`descriptionOverride` restent dégradés en `Record<string, never>` (dette §6 distincte, **explicitement laissée ouverte par 3.13-2a-back**) → **override CHIRURGICAL** `ProviderCatalogItem = Omit<…DTO, ces 3 champs> & { priceAmount: number|null; … }` dans `lib/providers/types.ts` (runtime : `priceAmount` = **number** via `Number(row.price_amount)`, pas une string). **Pas un miroir complet** — les maps restent natives. **BLOC IDENTITÉ** : `businessName` (fallback SOBRE « Prestataire » — le DTO ne porte AUCUN prénom/nom de repli, aucun champ inventé, aucun appel supplémentaire), `headline`/`bio` masqués si absents. **PAS** de `serviceRadiusKm`/`serviceBaseLocation` (bruit ici → 3.14). **BLOC SERVICES** : **liste PLATE** (pas de groupement par métier), métier en contexte + nom du service (i18n `pickTranslation` fr-CA), prix formaté fr-CA (« 85,00 $ », `/ h` si HOURLY), durée + `descriptionOverride` si présents. **CTA à DEUX IDs, RIEN D'AUTRE** : `/requests/new?providerId=<id de la page>&serviceId=<service.id>`. **POURQUOI le prix ne transite JAMAIS par l'URL** : `estimatedAmount` est libre côté backend (aucun contrôle contre le prix du service) → une URL trafiquée `amount=1` créerait une demande à 1 $ ; le formulaire RELIRA l'API pour dériver montant/devise/catégorie/item. **QUOTE_ONLY OU `priceAmount == null` (défense en profondeur : test du montant, pas seulement du `pricingModel`) → mention « Sur devis », AUCUN CTA** — un DIRECT_BOOKING sans montant est ININTERPRÉTABLE (garde 3.12b : montant null = acceptation impossible = demande morte-née) ; le vrai chemin devis = domaine Quotes (3.9), hors périmètre. **AUCUN badge de confiance** (Hard/Social Trust, `regulationLevel`, `verificationStatus`) — le backend filtre déjà l'inréservable → badge informatif, pas correctif → **différé 3.14**. **ÉTATS** : provider inconnu **404** OU id non-UUID **400** (`ParseUUIDPipe`) → **tous deux `notFound()`** (une URL malformée n'est pas une 5xx à afficher ; **status/flags capturés DANS le `try`, `notFound()` appelé APRÈS** — sinon le `catch` avalerait le signal, même raison que `redirect` hors try au dashboard ; le lint `react-hooks/error-boundaries` interdit d'ailleurs de construire du JSX dans un try/catch) ; identité en échec 5xx/réseau → StateCard sobre « Profil indisponible » ; **catalogue vide** (cas réel : alice a une catégorie mais AUCUN service) → EmptyHint sobre, **pas de crash, pas de 404** ; **erreur catalogue 5xx/réseau → l'identité reste lisible**, note sobre à la place de la liste (`services = null`). **VOUVOIEMENT** partout. **Stub `/requests/new`** (`app/(app)/requests/new/page.tsx`, Server Component) : lit `searchParams` (**Promise** en Next 16, `await`) et **écho** `providerId`/`serviceId` + « Bientôt disponible — tâche 3 ». **Raison d'être** : rendre le CTA testable de bout en bout (l'écho PROUVE que le lien porte les bons IDs) + donner à la tâche 3 une page à REMPLIR. **INTERDIT respecté** : aucun formulaire/champ/fetch/POST/validation/`'use client'`. Stubs `(app)/providers/page.tsx` (découverte, 3.14), `(app)/requests/page.tsx` (« Mes demandes », tâche 4) et `(app)/dashboard/requests/[id]` (prestataire) **NON touchés** — la nouvelle `[id]` est posée **À CÔTÉ** du stub `providers`. **Validé** : `pnpm --filter @linkr/web build` + typecheck + lint **verts** (routes `/providers/[id]` et `/requests/new` listées). **Smoke runtime = humain** (sandbox sans Docker/API). **UUID de test utiles** : provider bob `81127c85-c332-4388-a37c-a0aed100959e` ; service Coloration de bob `0762df57-2c62-45a6-bdb4-deaa39443f2e` (**FLAT, 85,00 CAD**) ; item Coloration `8d0719f4-f3dc-47ca-8dcc-0ea9aef928b9` ; métier Coiffure (catalogue) `0c44ccbd-fceb-4129-b81f-3e40c02ccdd3` ; psc coiffure de bob `9b3771fd-4bcf-415a-8ecd-b4d7ddc4ae4d` (**NOT_REQUIRED** → visible) ; psc plomberie de bob `208781b2-1746-41d2-bd04-f207c251c7aa` (**PENDING → INVISIBLE en public**, invariant cascade de confiance). **DETTE PRODUIT tracée (smoke 2a-back, NON corrigée ici, non bloquante)** : `POST /service-requests` **NE VÉRIFIE PAS** que le prestataire ciblé offre réellement le service demandé, ni qu'il est vérifié pour ce métier (le seed 3.12b ciblait bob en plomberie PENDING **sans aucun service** et la capture Stripe a quand même eu lieu) — à arbitrer plus tard.
**3.13-3a-bff** (front, BFF — le TUYAU avant l'UI) : **nouveau Route Handler `POST /api/service-requests`** (`apps/web/src/app/api/service-requests/route.ts`) — **premier maillon de la fermeture de boucle cliente**, construit et prouvé au curl **AVANT** le formulaire (tâche 3-front, PR suivante) pour qu'un échec ultérieur soit sans ambiguïté côté UI, jamais côté relais. **Frère EXACT des 4 handlers du dashboard** (`accept`/`decline`/`start`/`complete`) : même lecture du cookie d'accès via `getServerApiClient()` (client typé openapi-fetch, token httpOnly server-side), même **relais TRANSPARENT** (`NextResponse.json(error ?? data ?? null, { status: response.status })` → statut HTTP **et** corps upstream VERBATIM, y compris les corps d'erreur 400/401/409/422), même `catch → 502` sobre sur réseau/API injoignable, même absence de log du token. **DIFFÉRENCE vs les 4 frères** : eux sont des POST sans corps avec segment dynamique `[id]` ; ici **aucun segment** → signature `POST(request: Request)` (pas de `params`), et le handler **relaie un corps JSON entrant**. **Le typé porte le corps** (contrairement à `login` en fetch brut) : `POST /service-requests` déclare un vrai `requestBody` (`CreateServiceRequestDto`, vérifié au schéma l.3397) → `client.POST('/service-requests', { body })` avec `body = await request.json()` cast en `components['schemas']['CreateServiceRequestDto']`. **PURE TUBE, décisions VERROUILLÉES** : le BFF ne TRADUIT rien (le mapping FR vit dans le Client Component 3-front, **par code HTTP SEUL** — verrou 3.12b), ne MAPPE aucun code, ne VALIDE aucun champ métier (affaire de l'API : `CreateServiceRequestDto`), ne TRANSFORME pas le corps, n'INJECTE aucun champ. **En particulier : n'ajoute JAMAIS `clientUserId`** — l'API le dérive du `sub` du JWT (`service.create(user.sub, dto)`, vérifié au recon) ; injecter un id client serait un bug. Le corps de la requête cliente est transmis tel quel. Reste **Route Handler BFF** (PAS de Server Action — cohérence avec tout l'existant). **NON touchés** : `apps/api`, les 8 handlers existants, `proxy.ts`, la page `/requests/new` (PR suivante), les dettes connues. **Validé** : `pnpm --filter @linkr/web build` + typecheck + lint **verts**. **Smoke runtime = humain** (sandbox sans Docker/API) : au curl sur `:3001`, créer une demande OPEN ciblée bob → vérifier le **201 relayé** + l'apparition dans le dashboard prestataire.
**3.13-3-front** (front, la boucle SE FERME) : **le VRAI formulaire de création remplace le stub `/requests/new`** (`apps/web/src/app/(app)/requests/new/page.tsx`) — dernière pièce de la boucle transactionnelle cliente : profil prestataire → CTA « Demander » → CE formulaire → `POST /api/service-requests` (BFF 3a) → demande **OPEN** ciblée → dashboard de bob. Un humain crée désormais une **vraie demande sans SQL ni PowerShell**. **Server Component (page + garde) + Client Component MINIMAL (la seule saisie)** — pattern maison, aucun nouveau paradigme (**PAS de Server Action** : on poste vers le BFF via `fetch` client, cohérent avec l'existant ; **zéro nouvelle dépendance, zéro lib de formulaire**). **Page serveur** : `force-dynamic`, garde `getCurrentUser()` → `redirect('/login')` **HORS try/catch** (page **PRIVÉE** sous `(app)` malgré des endpoints `@Public()` — une session expirée ne doit pas rendre) ; lit `searchParams` `providerId`+`serviceId` (**Promise** Next 16, `await`), **manquants OU non-UUID → `notFound()`**. **GARDE ANTI-TRAFIQUAGE = LE CŒUR** : le prix n'est **JAMAIS saisi ni passé par l'URL** (`estimatedAmount` est libre côté API → une URL trafiquée `amount=1` créerait une demande à 1 $) — il est **DÉRIVÉ d'une RELECTURE SERVEUR** `GET /service-providers/{providerId}/services` (tableau nu, `Array.isArray`), on cherche l'item `id === serviceId` puis on projette `serviceItemId` + `serviceCategoryId` (**= le métier catalogue REQUIS par `CreateServiceRequestDto`, ≠ id de jonction**) + `priceAmount` (number) + `priceCurrency` + libellés i18n. **`notFound()` sur TOUT échec de dérivation** : provider inconnu / 400 / erreur transport / `serviceId` absent du catalogue / **`priceAmount == null` OU `pricingModel === 'QUOTE_ONLY'`** (défense en profondeur : on teste le **MONTANT**, pas que le modèle — un DIRECT_BOOKING sans montant est ININTERPRÉTABLE, garde 3.12b). **Piège `notFound()`/`redirect()` respecté** (rappel 2-front) : statut/flags capturés **DANS** le `try`, `notFound()` appelé **APRÈS** (le signal serait avalé par un `catch` ; le lint interdit du JSX en try/catch). **Identité** `GET /service-providers/{id}` best-effort (nommer le prestataire) → `businessName ?? « ce prestataire »` (fallback sobre, aucun champ inventé). **Client Component** (`create-request-form.tsx`) : contexte **LECTURE SEULE** (« Demande à &lt;businessName&gt; », « &lt;métier&gt; · &lt;service&gt; » via `pickTranslation` fr-CA, prix formaté `Intl.NumberFormat` fr-CA, fallback pair brut si code ISO inconnu) ; **3 champs SAISIS uniquement** — `title` (≤ 200), `description` (textarea), `serviceAddress` (≤ 500), chaque input avec `<label>` lié (a11y), vouvoiement, `noValidate` ; **validation client LÉGÈRE** (les 3 non-vides après `trim`, longueurs max) → message inline `role="alert"`, **aucun appel réseau** en échec. **Payload assemblé côté client** (`CreateServiceRequestDto`) : les 3 saisis + les **constantes/dérivés** — `requestType: 'DIRECT_BOOKING'`, `requestedServiceProviderId` (URL), `serviceItemId`+`serviceCategoryId`+`estimatedAmount`+`estimatedCurrency` (relecture), **`serviceLocation` = point Québec FIXE `{ type:'Point', coordinates:[-71.21, 46.81] }`** (⚠️ GeoJSON `[lng, lat]`, lng négatif ; **placeholder assumé** — aucun géocodage, dette tracée résorbée en 3.14 ; cast `as unknown as` sur le quirk JSONB `Record<string, never>`). **`desiredStartAtUtc` OMIS** (sélecteur date/UTC = chantier futur ; la boucle se ferme sans). **POST `fetch('/api/service-requests')`**, état `pending` (bouton désactivé, anti double-clic). **MAPPING FR PAR CODE HTTP SEUL** (jamais parser le corps, verrou 3.12b, vouvoiement) : 400 → « Certains champs sont invalides… » ; 401 → « Votre session a expiré… » ; 409 → « Cette demande n'est plus disponible. » ; **502 / réseau / autre → « Service momentanément indisponible… »**. **SUCCÈS (201) → ÉCRAN DE CONFIRMATION EN PLACE** (état React, **PAS de `redirect`, PAS de `router.refresh`**) : « Votre demande a été envoyée à &lt;businessName&gt;. » + récap (service, prix, adresse saisie) + lien discret « Retour à l'accueil » → `/` (**on NE redirige PAS vers `/requests`, encore un stub — tâche 4**). **LA BOUCLE TRANSACTIONNELLE CLIENTE EST FERMÉE.** **NON touchés** : `apps/api`, le BFF `route.ts` (livré 3a), `proxy.ts`, la page profil, le dashboard, les stubs voisins. **Dettes rappelées (NON corrigées ici)** : le fallback 502 du BFF 3a reste **tutoyant** (« Réessaie plus tard. ») — divergence assumée, le mapping client vouvoie ; et **`POST /service-requests` ne vérifie ni que le provider offre réellement le service ni qu'il est vérifié pour le métier** (dette produit tracée en 2-front, à arbitrer plus tard). **Validé** : `pnpm --filter @linkr/web` **build + typecheck + lint verts** (`/requests/new` listée `ƒ` dynamique, aucune collision). **Smoke runtime = humain** (sandbox sans Docker/API) : `/requests/new?providerId=81127c85-c332-4388-a37c-a0aed100959e&serviceId=0762df57-2c62-45a6-bdb4-deaa39443f2e` (bob, service Coloration FLAT 85,00 CAD) → remplir les 3 champs → 201 → confirmation → la demande OPEN apparaît dans le dashboard de bob.
**3.13-A** (backend, contrat — dette de contrat symétrique à #23) : **typage de l'enveloppe de `GET /service-requests`** (`ServiceRequestsController.findAll`). **LE BUG** : le `@Get()` `findAll` renvoie au runtime `{ items: ServiceRequestResponseDto[]; total; page; limit }` mais ne portait **AUCUN `@ApiResponse`** → NestJS générait un `200` **vide** (`content?: never` côté `schema.d.ts` ; `"description": ""` sans `content` côté `openapi.json`) : la liste cliente/admin était **inconsommable typée** par le front. **PATRON CALQUÉ VERBATIM sur 3.12a-back-fix** (qui a résolu le même mensonge `isArray` sur l'endpoint prestataire `GET /service-providers/{id}/service-requests`) : **DTO d'enveloppe dédié**, **PAS** de générique `PaginatedResponseDto<T>` spéculatif (généralisation reportée à un vrai usage répété). **Nouveau DTO** `service-request-list.dto.ts` → `ServiceRequestListDto` : `items` (`@ApiProperty({ type: ServiceRequestResponseDto, isArray: true })`) + `total`/`page`/`limit` (`@ApiProperty` `number`), important `ServiceRequestResponseDto` du fichier voisin. **Contrôleur** : ajout de `@ApiResponse({ status: 200, type: ServiceRequestListDto })` sur le `@Get()` + type de retour inline `Promise<{ items…; total…; page…; limit… }>` remplacé par `Promise<ServiceRequestListDto>` (l'inline de `service.list()` y est **structurellement assignable** → **corps de méthode INCHANGÉ**, `return this.service.list(...)` compile tel quel). **Déviation ASSUMÉE vs le libellé littéral de la tâche** (`@ApiResponse({ type })` sans `status`) : j'ai mis **`status: 200`** — sinon l'annotation atterrit sous `responses.default` et **ne type PAS le 200** (l'objectif) ; `status: 200` est aussi ce qu'utilisent le précédent 3.12a-back-fix ET toutes les autres réponses succès de ce contrôleur (`create`/`findOne`/`cancel`/`accept`…). **STRICTEMENT INTACTS** (hors périmètre, non touchés) : `ServiceRequestResponseDto` (aucun champ, aucune annotation — `serviceLocation` GeoJSON et `clientUserId` **restent tels quels**), `service-requests.service.ts` (`list()` garde son **type de retour inline** — défaut de la tâche : **ne PAS** le remplacer par le DTO, le contrôleur suffit au contrat), `service-request.repository.ts` (`findAll` intact). **ZÉRO logique, ZÉRO migration, ZÉRO champ.** **Contrat régénéré EN BOOTANT L'APP** (jamais à la main), commandes exactes : `pnpm --filter @linkr/api openapi:generate` (boote le vrai Nest via `NestFactory.create` → connecte Postgres + Redis, aucune migration car `synchronize:false`) **puis** `pnpm --filter @linkr/api-client codegen`. **Contrairement à 3.13-2a-back** (sandbox sans stack → régén. laissée à l'humain), **cet environnement disposait de Postgres 16 + Redis + PostGIS 3.4** (montés localement pour le boot) → **régénération faite ici**. **Diff des générés STRICTEMENT SCOPÉ** (vérifié, zéro champ collatéral) : `openapi.json` = 2 hunks (+37/−1) → le `200` de `/service-requests` get passe de `"description": ""` (vide) à un `content.application/json.schema.$ref → ServiceRequestListDto`, + ajout du schéma `ServiceRequestListDto` dans `components.schemas` ; `schema.d.ts` = 2 hunks (+12/−1) → `ServiceRequestsController_findAll.responses.200` passe de `content?: never` à `content: { "application/json": components["schemas"]["ServiceRequestListDto"] }`, + le type `ServiceRequestListDto`. **AUCUNE autre route modifiée dans le contrat** ; `ProviderServiceRequestListDto` (3.12a) **non touché**. **Consommateurs `apps/web` vérifiés** : seuls `POST /service-requests` (BFF 3a) et l'endpoint prestataire distinct `/service-providers/{id}/service-requests` sont consommés — **aucun consommateur du type de réponse `GET /service-requests` list** → typage **purement additif, non-breaking**. **Validé** : `pnpm --filter @linkr/api build` **vert** ; `@linkr/api-client` + `@linkr/web` **typecheck verts** (`tsc --noEmit`). **Smoke DB = humain** sur `:5000` après revue (créer/lister des demandes) — hors périmètre de cette session (1 session = 1 PR, pas de self-merge).
**3.13-B** (front, web only) : **la page « Mes demandes » `/requests` RÉELLE remplace le stub 3.13-PR2** + **dé-culisage de l'écran de confirmation**. Une seule responsabilité : le client voit ses demandes, et la confirmation l'y mène. **Server Component `force-dynamic`**, garde `getCurrentUser()` en tête → `redirect('/login')` **HORS try/catch** (page **PRIVÉE** sous `(app)` : une session expirée ne doit pas rendre), lecture directe via `getServerApiClient()` — **patron EXACT du dashboard prestataire**. **UN SEUL appel** `GET /service-requests?limit=100` **SANS filtre `status`** (le split se fait côté serveur). **PAS de handler BFF GET** (règle verrouillée : le BFF ne sert qu'aux **mutations**). **TYPAGE — l'enveloppe est native, MAIS *info nouvelle vs le plan* signalée** : l'enveloppe `ServiceRequestListDto` (`items`/`total`/`page`/`limit`) est **consommée NATIVEMENT sans aucun cast** (grâce à PR A #42) ; **cependant** les **2 champs monétaires que la carte LIT** — `estimatedAmount`/`estimatedCurrency` — **restent dégradés en `Record<string, never>`** sur `ServiceRequestResponseDto` (**dette nullable §6 NON résolue par PR A**, qui n'a typé que **l'enveloppe**, pas les nullables de l'item — cf. note 3.13-A « `ServiceRequestResponseDto` STRICTEMENT INTACT »). → **cast CHIRURGICAL scoped aux 2 champs SEULS** (`as unknown as string | null`) **dans la carte**, documenté noir sur blanc ; `title`/`serviceAddress`/`status`/`createdAtUtc` **lus NATIVEMENT**. L'exigence dure (« zéro cast **sur l'enveloppe** ») est **respectée** ; le cast des 2 fields est le résidu JSONB anticipé par la tâche (« si un champ que tu LIS force un cast → signale-le »). **SPLIT côté serveur** (**Option A**, pagination différée — même dette que le dashboard) : **« En cours »** = `{DRAFT, OPEN, ASSIGNED, IN_PROGRESS, COMPLETED}` / **« Terminées »** = `{PAID, CANCELLED, EXPIRED, REFUNDED}` ; tri `created_at DESC` (garanti API) **préservé** par `filter` (pas de re-tri). **CARTE MINCE co-localisée** (`requests/_components/request-card.tsx`) : `title` (**le porteur de sens** — écrit par le client), `serviceAddress`, **montant estimé** (`estimatedAmount`+`estimatedCurrency`, helper fr-CA **même sortie visuelle que `priceLabel`** du formulaire de création, `null → « — »`, **JAMAIS de dépôt, JAMAIS de taux** — règle métier), **date** (`createdAtUtc` fr-CA **date seule**), **badge de statut**. **NE PAS afficher** (choix **②-mince, différé ASSUMÉ**) : `serviceCategoryId`/`serviceItemId` (UUID bruts, **aucun libellé i18n joint dans ce DTO**), `requestedServiceProviderId`/`assignedServiceProviderId` (UUID bruts, **aucun nom joint**), ni `serviceLocation` (GPS). **MAP STATUT** : **libellés CLIENT** (« En attente », « Acceptée », « En cours de réalisation », « Complétée »… — **≠ libellés prestataire-centrés** du dashboard « Ouverte »/« Assignée »/« En cours ») ; **COULEURS = MIROIR** des familles Tailwind du dashboard par statut (cohérence visuelle entre les deux vues). **DRY — VOIE 2 prise (signalée)** : le `STATUS_BADGES` du dashboard est un **const LOCAL NON exporté** → **dashboard NON touché**, helper **SCOPÉ à `/requests`** créé (mêmes couleurs, libellés client) + **dette tracée** « extraction d'un helper statut partagé entre les deux vues » (chore futur ; le helper `formatMoney` fr-CA est de même mirroré localement, même dette). **ÉTATS (vouvoiement)** : liste **totalement vide** (ex. carol) → **état vide global unique** « Vous n'avez pas encore de demande. » + lien découverte `/` (pas deux sections vides) ; sinon **en-tête de section rendu QUE si ≥1 item** (pas d'en-tête « Terminées » orpheline) ; **échec API 5xx/réseau** (`requests === null`) → **StateCard sobre « Chargement impossible »** (défensif, patron dashboard — pas de fausse liste vide sur un 500). **Vocabulaire « demande » partout** (titres de section, états vides) — **JAMAIS « mandat »** (réservé au prestataire). **LIVRABLE 2 — dé-culisage** : bloc `if (submitted)` de `create-request-form.tsx`, **diff ADDITIF SEUL** — **CTA PRIMAIRE « Voir mes demandes »** → `<Link href="/requests">` **stylé en bouton primaire** (réutilise le style du bouton submit du formulaire), **« ← Retour à l'accueil » CONSERVÉ, rétrogradé en lien SECONDAIRE**, primaire d'abord. **Récap, logique submit, POST INTACTS.** **INTERDITS respectés** : aucun handler BFF GET ; **dashboard prestataire NON modifié** (helper local non exporté → pas d'import possible) ; **backend / API / `ServiceRequestResponseDto` INTACTS** (PR A a déjà fait le contrat) ; **zéro migration**. **Validé** : `pnpm --filter @linkr/web` **build + typecheck + lint VERTS** (`/requests` + `/requests/new` listées `ƒ` dynamiques, aucune collision), **enveloppe consommée SANS cast** (seuls les 2 champs monétaires dégradés sont cast, scoped + documenté). **Smoke navigateur = humain** sur `:3001` après revue (sandbox sans Docker/stack API).
**3.14a** (front, web only — première tâche de la phase 3.14 « Découverte / recherche geo ») : **écran de recherche géo côté client `/recherche`** — le client choisit un métier, clique « Près de moi », voit la liste des prestataires éligibles à proximité, chaque carte liant vers le profil prestataire **déjà existant** `/providers/{id}` (3.13). **SLICE FRONT PUR : zéro nouvel endpoint, zéro migration, zéro changement backend** (le `discover` back existait déjà, prêt — **pas touché**). **Voie Ⓒ — Server Component piloté par l'URL (verrouillé)** : les coords naissent dans le navigateur (`navigator.geolocation`), le token vit en cookie httpOnly server-side ; le Client Component **écrit les coords DANS l'URL** (`router.push`), le Server Component **lit `searchParams` + cookie** et appelle `discover`. **AUCUN route handler BFF GET** (règle maintenue : BFF = mutations seulement) — **l'URL est le joint de découplage** (la 3.14b y branchera le géocodage sans rien retoucher). **Vérité terrain (smoke stack réelle)** : `GET /service-providers/discover?lat=&lng=&categoryId=&page=&limit=` = **JWT REQUIS** (401 sans token → écran authentifié), **`categoryId` OBLIGATOIRE** (400 s'il manque → le métier doit être choisi AVANT de chercher, pas de mode « tout à proximité »), réponse = **enveloppe** `{items,total,page,limit}` ; item = `{id, providerType, displayName, headline, serviceRadiusKm, distanceMeters, categoryVerificationStatus}` — **`distanceMeters` déjà calculé/joint**, **GPS jamais exposé** (minimisation Loi 25 à la source), `categoryVerificationStatus` ∈ {`VERIFIED`, `NOT_REQUIRED`} (le back filtre le reste). **Fichiers créés** : `app/(app)/recherche/page.tsx` (Server Component `force-dynamic`, garde `getCurrentUser()` → `redirect('/login')` HORS try/catch — **patron EXACT de `/requests`**) ; `recherche/_components/search-form.tsx` (**SEULE surface `'use client'`**) ; `recherche/_components/provider-card.tsx` (carte **serveur**, pas de `'use client'`) ; `lib/providers/discovery-types.ts` (miroir). **Nav** : entrée **« Rechercher »** (→ `/recherche`) ajoutée dans `(app)/nav.tsx` (les liens y sont **codés en dur** ; `lib/nav/` ne contient que `capabilities.ts`, **aucun registre de liens** → rien à y modifier). **DEUX quirks de contrat (miroir front + dette tracée, PAS de fix backend ici)** : (1) **l'enveloppe `discover` ment** — annotée **tableau nu** `DiscoveredProviderDto[]` dans `schema.d.ts` alors que le runtime renvoie l'enveloppe (quirk connu #23/3.12a/3.13-A) → miroir `DiscoveredProviderList` + cast `as unknown as` au call-site ; (2) **`GET /service-categories` sans schéma de réponse** (`content: never`, tableau nu au runtime) → miroir minimal `CategoryOption` (`id`+`nameTranslations`+`sortOrder`, **ce dont le `<select>` a besoin SEULEMENT**). En sus, les 2 nullables `displayName`/`headline` de l'item `discover` dégradent en `Record<string, never>` (dette *nullable* §6) → **re-typés chirurgicalement `string | null`** dans le miroir via `Omit<DiscoveredProviderDto, 'displayName'|'headline'> & {…}` (enums/nombres restent **dérivés** du schéma généré, pas de dérive). **`page.tsx`** : fetch serveur des métiers via `getServerApiClient()` (le client ne fetch **jamais** rien d'authentifié lui-même), tri par `sortOrder`, libellé `fr-CA` via `pickTranslation`, passés en **props** ; lit `searchParams` (`categoryId`/`lat`/`lng`, **Promise** Next 16 → `await`) ; **déclenche `discover` UNIQUEMENT si les trois sont présents ET valides** (`categoryId` = UUID, `lat`/`lng` = nombres finis) — construits en **query typée via un ternaire narrowant** (`lat`/`lng` → `number`, `categoryId` → `string`) ; sinon **État 0** (formulaire seul, pas de section résultats). `discover` appelé `page=1&limit=50` (**pagination différée assumée**, un seul appel — même dette que dashboard/`/requests`). **États** : `total>0` → liste de `provider-card` ; `total===0` → StateCard « Aucun prestataire proche pour ce métier… » ; erreur 5xx/réseau → StateCard « Recherche impossible… » (**patron `/requests`**). **`search-form.tsx`** : `<select>` (option vide « Choisir un métier » + options triées, `value=category.id`, texte fr-CA), état local `categoryId` **initialisé depuis `searchParams`** (cohérence au re-render — l'îlot survit à la soft-nav) ; bouton **« Près de moi » désactivé tant qu'aucun métier n'est choisi** (+ hint « Choisissez d'abord un métier ») ; au clic → `navigator.geolocation.getCurrentPosition(success, error, { timeout:10000, enableHighAccuracy:false })` : succès → `router.push('/recherche?categoryId=…&lat=…&lng=…')` (coords **brutes**, `String()` — pas de `toFixed`, l'URL colle au capteur DevTools, ex. `lat=46.81`) ; refus/timeout/indisponible → **État E** message sobre « Autorisez la géolocalisation… » + bouton **Réessayer** (**NE PROMET PAS la recherche par adresse** — elle n'existe qu'en 3.14b, pas de vaporware) ; état de chargement local « Localisation… », **`locating` remis à `false` AVANT le push** (sinon l'îlot préservé fige le bouton). **`provider-card.tsx`** : toute la carte = `<Link href="/providers/{id}">` (**frontière stricte 3.14a** : la recherche s'arrête au lien, la boucle 3.13 est **intacte**, le placeholder `serviceLocation` **non touché**) ; `displayName` **repli « Prestataire »** (nullable au contrat), `headline` **masqué si null** (jamais « null » affiché), **distance fr-CA** (`<1000` → « à {round} m » ; sinon « à {km,1 déc.} km » via `Intl.NumberFormat('fr-CA', {min/maxFractionDigits:1})` — 460→« à 460 m », 1240→« à 1,2 km ») ; **badge Ⓐ** : `categoryVerificationStatus==='VERIFIED'` → pastille « ✓ Licence vérifiée » (famille emerald, cohérente dashboard) ; **RIEN sur `NOT_REQUIRED`** (le silence est neutre — jamais « non vérifié » sur un métier informel = faux signal négatif). **Vouvoiement partout**, vocabulaire client, **rien de financier surfacé**. **Auth** : page **privée** sous `(app)` (proxy deny-by-default, `PUBLIC_PAGES=['/login']` **non touché**) **+** garde `getCurrentUser()` propre. **Dettes tracées** (cf. §6 Technical Debt) : fix contrat `discover` (annotation → DTO d'enveloppe) ; pagination différée `/recherche` ; rappels 3.14b (géocodage adresse + threading vraies coords → tuer le placeholder `serviceLocation`) ; découverte publique/anonyme (rendre `discover` `@Public()` + rate-limit) = chantier futur distinct. **Validé** : `pnpm --filter @linkr/web` **typecheck + lint + build VERTS** (`/recherche` listée `ƒ` dynamique, aucune collision) ; **schéma inchangé** (aucun backend touché → diff `openapi.json`/`schema.d.ts` **vide**, comme attendu). **Smoke navigateur = humain** sur `:3001`/`:5000` (sandbox sans Docker/stack API) : DevTools → Sensors → Location `46.81,-71.21` ; Coiffure `0c44ccbd-fceb-4129-b81f-3e40c02ccdd3` → **2 cartes** (Alice Coiffure + provider de bob, distance, **AUCUN badge** = branche `NOT_REQUIRED`, `headline` null ⇒ ligne absente) ; Plomberie `8e8f4c31-1756-4763-ac88-0d7866e35777` → **0** (empty state, bob plomberie `PENDING` masqué) ; refus géoloc → État E ; carte → `/providers/{id}` ; URL `?categoryId=…&lat=…&lng=…` re-collée dans un onglet connecté → **mêmes résultats** (preuve du joint de découplage) ; déconnexion → `/recherche` redirige `/login`. **Trou de couverture visuelle noté** : aucun seed `VERIFIED` sur un métier réglementé près du point → **badge validé par lecture de code** (la branche `NOT_REQUIRED`/silence est prouvée par le test Coiffure) ; vérif à l'œil = promotion SQL temporaire d'une `provider_service_categories` en `VERIFIED` puis revert (optionnel). **Utilisateur de test purement client** : `carol@linkr.test` (aucun provider) couvre la garde et la nav non-prestataire.
**3.14b-back** (backend, **détour contrat** — 2ᵉ tâche de la phase 3.14) : **couture de géocodage (port/adapter) + endpoint proxy `GET /geocode?q=&limit=`** qui transforme une adresse texte en **LISTE de candidats** `{label, lat, lng}` (décimales WGS84). **Contrairement à 3.14a (slice front pur)** : nouvel endpoint backend + **régénération `openapi.json`/`schema.d.ts`**. Mais **ZÉRO migration** (géocodage **sans état**, aucune table) et **ZÉRO front** (le champ adresse qui le consommera = 3.14b-front, hors scope). **La couture (mirror EXACT de `common/storage/`)** : `common/geocoding/geocoding.interface.ts` (port `IGeocodingService` + token `GEOCODING_SERVICE`, mêmes conventions que `IStorageService`/`STORAGE_SERVICE`), `nominatim-geocoding.adapter.ts` (l'adapter), `geocoding.module.ts` (câblage + **sélection par `GEOCODING_PROVIDER`** — seul `nominatim` valide, valeur inconnue → `throw` au boot **comme STORAGE_DRIVER** ; **exporte** `GEOCODING_SERVICE`). **Déviation ASSUMÉE vs StorageModule** : la couture est **NON-`@Global`** (StorageModule l'est) — son unique consommateur est le module feature géocodage qui l'**importe explicitement** (`imports:[…]`), câblage plus serré qu'un @Global pour un seul consommateur local. **La route (thin feature module)** : `modules/geocoding/geocoding.controller.ts` (`@Controller('geocode')` + `@Get()` → `GET /geocode`), `modules/geocoding/geocoding.module.ts` (importe la couture, déclare le contrôleur), `dto/{geocode-query,geocode-candidate,geocode-result}.dto.ts`, enregistré dans `AppModule`. **Piège de nommage résolu** : les DEUX modules s'appellent `GeocodingModule` (couture + feature) → le feature **aliase l'import de la couture** (`import { GeocodingModule as GeocodingSeamModule }`) pour garder le nom canonique sans collision ; `AppModule` n'importe **que** le feature (la couture est tirée transitivement). **Adapter Nominatim** : `fetch` **natif** (Node global — **zéro nouvelle dépendance**), `GET {NOMINATIM_BASE_URL}/search?q=&format=jsonv2&limit=&countrycodes=ca&accept-language=fr-CA`, header **`User-Agent` (OBLIGATOIRE ToS Nominatim — sans lui, bloqué)** + `Accept-Language: fr-CA`, **timeout 5 s** (`AbortSignal.timeout`). Mappe **`lon → lng`** et **`parseFloat` (chaînes → nombres)**, **filtre** tout candidat `lat`/`lng` non fini. **Erreur réseau/timeout/statut non-2xx/payload non-tableau → `BadGatewayException` (502)** message **vouvoyé** « La recherche d'adresse est momentanément indisponible. Veuillez réessayer. » (jamais tutoyer — leçon verrouillée ; cause jamais fuitée au client, seulement loggée). **Contrat = ENVELOPPE HONNÊTE dès le départ** : `GeocodeResultDto { candidates: GeocodeCandidateDto[] }` — **PAS un tableau nu** (leçon des 3 morsures « annotation array menteuse » : discover / service-categories / provider-service-requests). **Zéro candidat = `200 { candidates: [] }`** (jamais 404 — le géocodage **propose**, le client **disposera** en 3.14b-front). **JWT-gardé** (guard global, **pas de `@Public()`** — même posture que `discover` qui consomme ces coords). **`GeocodeQueryDto`** : `q` **requis, non vide APRÈS trim** (`@Transform` trim → `@IsNotEmpty` → whitespace-only = **400**), `limit` optionnel `@IsInt @Min(1) @Max(10)` défaut 5 (hors bornes = **400**, pas de clamp — comme discover). **Décorateur ⟷ type ALIGNÉS** sur le contrôleur (`@ApiResponse({status:200, type:GeocodeResultDto})` **et** retour `Promise<GeocodeResultDto>`) — ferme la dérive « annotation qui ment ». **Env (schéma Joi étendu + `.env.example`)** : `GEOCODING_PROVIDER` (`.valid('nominatim').default('nominatim')` — **comme STORAGE_DRIVER**), `NOMINATIM_BASE_URL` (`.uri().default('https://nominatim.openstreetmap.org')`), **`NOMINATIM_USER_AGENT` = REQUIS, SANS défaut** (choix délibéré : la ToS exige un UA identifiant **CE** déploiement + un contact réel ; un défaut embarqué ferait partager un même faux UA à tous → bloqué ; donc **crash au boot si absent**, honore « env strict »). **Régén. `openapi.json` + `schema.d.ts` = FAITE ICI EN BOOTANT L'APP** (jamais à la main) : contrairement à 3.13-2a-back (sandbox nu), **cet environnement disposait de la stack** (Postgres 16 + PostGIS 3.4 + Redis montés localement pour le boot, comme 3.13-A) → `pnpm --filter @linkr/api openapi:generate` puis `pnpm --filter @linkr/api-client codegen`. **Diff STRICTEMENT SCOPÉ** (vérifié) : `openapi.json` **+91/−0** (uniquement le chemin `/geocode` + schémas `GeocodeCandidateDto`/`GeocodeResultDto`), `schema.d.ts` **+76/−0** (idem) — **zéro autre route/schéma touché**. **Validé** : `pnpm --filter @linkr/api build` **vert** ; **l'app BOOTE** avec `GeocodingModule` (`Mapped {/geocode, GET}`, **aucun cycle**, l'adapter se construit au boot → `getOrThrow` des vars env résolu). **Probes runtime `:5000`** (JWT **stateless**, la stratégie ne fait **aucun lookup DB** → token forgé signé avec `JWT_ACCESS_SECRET`, aucune seed nécessaire) : sans token → **401** ; token valide + `q=` / `q=` (espaces) / `limit=50` / `limit=0` → **400** ; `q=Laval` → **502** au message vouvoyé exact — **l'outbound Nominatim étant BLOQUÉ par l'agent-proxy du sandbox (403 CONNECT)**, ce blocage a **prouvé pour de vrai** le mapping erreur-réseau → 502 de l'adapter. **`200`-avec-candidats & liste-vide-`200` = SMOKE HUMAIN** (§9 du prompt, sur la stack Docker à outbound ouvert ; Nominatim est injoignable depuis ce sandbox — c'est la seule branche non exerçable ici, cf. helpers PS de la checklist §9). ESLint = **dette flat-config pré-existante** (pas d'`eslint.config.js` → ESLint 10 refuse ; **non touchée**). **Anti-objectifs respectés** : zéro migration, zéro front, `discover`/`service-requests`/placeholder `serviceLocation` **NON touchés**, pas de cache/rate-limiter (dettes §6), pas de tableau nu, pas de nouvelle dépendance. **UUID de test utile** (bout-en-bout humain §9.2) : métier Coiffure `0c44ccbd-fceb-4129-b81f-3e40c02ccdd3` (géocoder une adresse près de Québec → injecter ses `lat`/`lng` **bruts** dans `discover` → `total > 0` prouve que la sortie du géocodeur alimente `discover` **sans transformation**).
**3.14b-front** (front, web only — **3ᵉ tâche de la phase 3.14**, la boucle adresse→coords→prestataires se ferme côté client) : **recherche par adresse sur `/recherche`** — 2ᵉ méthode de localisation (**champ adresse**) qui appelle `GET /geocode`, affiche une **liste de candidats désambiguïsée**, et dont le clic lance `discover` ; **plus** le polissage de l'« État E » (refus de géoloc). **SLICE FRONT PUR : zéro backend, zéro migration, diff `openapi.json`/`schema.d.ts` VIDE** (aucun boot, aucune régén — l'endpoint `/geocode` existait déjà, 3.14b-back, **non touché**). **On ÉTEND l'écran 3.14a**, on ne recrée pas. **Voie Ⓒ′ — double joint URL (verrouillé)** : l'URL reste le joint de découplage ; le champ adresse est un **2ᵉ écrivain** dessus, à côté de « Près de moi ». **AUCUN route handler BFF GET, AUCUNE Server Action** pour lire `/geocode` (règle maintenue : BFF = mutations seulement) — le Client Component **écrit `?q=&categoryId=` dans l'URL**, le Server Component lit `searchParams` + cookie httpOnly et appelle `/geocode` **serveur-side** (même patron que la voie Ⓒ de 3.14a ; c'est la réponse à la dette §6 « comment le navigateur atteint `/geocode` »). **State machine `page.tsx` pilotée par `searchParams`, ordre de priorité** : `lat+lng+categoryId` valides → **discover** (cartes) `[3.14a INCHANGÉ]` ; sinon `q`+`categoryId` (UUID) → **geocode** (liste candidats) `[NOUVEAU]` ; sinon → **ÉTAT 0** (formulaire seul). Narrowing TS propre (`discoverQuery`/`geocodeQuery` + `geocodeQuery && validCategoryId` narrows `validCategoryId` → `string` pour `CandidateList`). **`q` whitespace-only → ÉTAT 0** (jamais un 400 inutile — le back rejette un `q` blanc ; `q?.trim()` falsy dégrade). **Symétrie ① (verrouillée)** : les **DEUX** voies (« Près de moi » ET champ adresse) sont **inertes tant qu'aucun métier n'est choisi** (`disabled={noCategory}` + hint « Choisissez d'abord un métier ») ; `categoryId` **thread partout** (`?q=&categoryId=` puis `?categoryId=&lat=&lng=`). **Géocodage déclenché par SOUMISSION** (bouton « Rechercher cette adresse » **ou touche Entrée** via `<form onSubmit>`) → push `?q=<adresse>&categoryId=<id>` ; **PAS d'autocomplete-au-frappé** (impossible sous le joint URL — contrepartie assumée de Ⓒ′). **Clic candidat = 2ᵉ push** `?categoryId=&lat=&lng=` (coords **brutes**, `String()`, **pas de `toFixed`** — colle au format que `discover` consomme et que « Près de moi » pousse déjà) → **feu immédiat sur `discover`** (symétrique avec la géoloc : choisir = valider). **Frontière stricte** : 3.14b-front **s'arrête** au `discover` qui suit le choix de candidat ; la **création de demande (3.13)** et le placeholder `serviceLocation = [-71.21, 46.81]` restent **INTACTS** — c'est **3.14c**. **TYPAGE — contraste POSITIF avec les quirks connus** : `GeocodeResultDto { candidates: GeocodeCandidateDto[] }` et `GeocodeCandidateDto { label, lat, lng }` sont générés **PROPREMENT** dans `schema.d.ts` (vraie **enveloppe** honnête + `content` typé, l.1992/2009/4586 — 3.14b-back a fermé la dérive « annotation array menteuse » dès le départ) → **type consommé NATIVEMENT** (`components['schemas']['GeocodeCandidateDto']`, **ZÉRO miroir local, ZÉRO cast**), à l'**inverse** de `discover` (enveloppe mensongère → miroir `DiscoveredProviderList` + cast) et `service-categories` (`content: never` → miroir `CategoryOption`), tous deux **conservés tels quels** dans la branche discover. **Fichiers** — **modifiés** : `recherche/page.tsx` (discriminateur étendu : parse `q`, `discoverQuery`/`geocodeQuery`, fetch `client.GET('/geocode', { params: { query: { q, limit: 5 } } })` serveur-side, états geocode ; passe `selectedAddress={q}` au form) ; `recherche/_components/search-form.tsx` (**seule surface `'use client'`** : champ adresse `<input type="text">` + bouton « Rechercher cette adresse » dans un `<form onSubmit={submitAddress}>`, valeur initiale = `searchParams.q`, **symétrie ①** ; **correctif État E** cf. infra) — **créé** : `recherche/_components/candidate-list.tsx` (**Server Component**, `next/link` par candidat → `?categoryId=&lat=&lng=`, titre « Choisissez l'adresse exacte : », `'use client'` **évité**). **États geocode (StateCard, patron `/requests`, vouvoiement)** : `candidates.length === 0` → « Aucune adresse trouvée. Précisez votre recherche. » (jamais une erreur — `200 {candidates:[]}`) ; échec 502/réseau (`geocodeFailed`) → « La recherche d'adresse est impossible pour le moment. Veuillez réessayer plus tard. ». **POLISSAGE ÉTAT E (dette 3.14a SOLDÉE)** : avant, un refus de géoloc laissait la bannière « Autorisez la géolocalisation… » **par-dessus des résultats serveur périmés** (searchParams encore peuplés). **Correctif** : chemin d'échec factorisé `failGeo()` (refus **ET** timeout **ET** `navigator.geolocation` indisponible) → `router.push('/recherche?categoryId=<id>')` (**repli ÉTAT 0 en conservant le métier**) **puis** `setGeoError(true)` — plus **aucun** résultat périmé sous la bannière (l'îlot est préservé à la soft-nav → l'état `geoError` survit). Message + « Réessayer » **inchangés** ; **pas** de promesse « recherche par adresse » (le champ dédié est désormais visible juste au-dessus). Une soumission d'adresse réussie **efface** aussi la bannière (`setGeoError(false)` dans `submitAddress`). **Vouvoiement partout**, vocabulaire client (« adresse », « prestataire »). **Auth** : page **privée** sous `(app)` (garde `getCurrentUser()` → `redirect('/login')` HORS try/catch, patron `/requests`) ; `proxy.ts`/`PUBLIC_PAGES` **non touchés**. **Dettes** (cf. §6) : État E **soldée** ; « comment le navigateur atteint `/geocode` » **résolue** (Voie Ⓒ′) ; **reste ouvertes** — pagination différée (s'étend à la branche geocode : `/geocode?limit=5`, un seul appel, aucune UI « plus de candidats »), threading vraies coords → **3.14c** (mort du placeholder `serviceLocation`), cache Redis + rate-limiter géocodage (3.14b-back), rationalisation nav « Trouver un pro » vs « Rechercher ». **Anti-objectifs respectés** : zéro backend/migration, `/geocode` & `discover` **non touchés**, placeholder `serviceLocation` **non touché**, pas de BFF GET / Server Action, pas d'autocomplete-au-frappé, pas de géocodage sans métier, `dashboard/requests/[id]` non touché, surface `'use client'` minimale (seul `search-form.tsx`). **Validé** : `pnpm --filter @linkr/web` **typecheck + lint + build VERTS** (`/recherche` listée `ƒ` dynamique, aucune collision) ; **schéma inchangé** (aucun backend touché → diff `openapi.json`/`schema.d.ts` **VIDE**, conforme). **Smoke navigateur = humain** sur `:3001`/`:5000` (sandbox sans stack Docker ; Nominatim de toute façon injoignable ici) : Coiffure → « Laval, Quebec » → Entrée → URL `?q=Laval…&categoryId=…` → liste de candidats ; clic candidat → `?categoryId=…&lat=…&lng=…` → cartes ; « asdkjfhqwoeiu » → « Aucune adresse trouvée » ; refus géoloc après une recherche → bannière **sans** résultats périmés ; URLs `?q=…` et `?lat=…&lng=…` re-collées dans un onglet connecté → mêmes résultats (double joint). **Utilisateur de test purement client** : `carol@linkr.test`.
**3.14c-1** (front, web only — **4ᵉ tâche de la phase 3.14**, la vraie coord atteint enfin le POST) : **propagation de la coordonnée cherchée jusqu'à la création de demande** — carte de résultat → profil prestataire → formulaire de demande, **via l'URL**, pour que `POST /service-requests` reçoive la **vraie** `serviceLocation` au lieu du placeholder point-Québec-fixe. **Mort du placeholder sur le happy path.** **SLICE FRONT PUR : zéro backend, zéro migration, diff `openapi.json`/`schema.d.ts` VIDE** (le back accepte déjà `serviceLocation` en entrée — vérifié, **non touché**). **Voie Ⓐ — propagation par l'URL (verrouillé)** : l'URL reste le joint de découplage (continuité 3.14a/b) ; les coords s'écrivent dans chaque lien et se lisent à l'autre bout. **Aucun état persisté, aucun cookie, aucun store.** **CHAÎNE À 3 MAILLONS** (les trois faits — réparer seulement l'aval laisserait les coords mourir en amont) : **Maillon 1** `recherche/_components/provider-card.tsx` — la carte reçoit `lat`/`lng` **en props** depuis `recherche/page.tsx` (qui les détient déjà pour appeler `discover` ; `discoverQuery` non-null dans la branche → `discoverQuery.lat`/`.lng` sont des `number` finis, **zéro hack client**, la carte reste **Server Component**), lien → `/providers/{id}?lat=<lat>&lng=<lng>` (repli lien nu si props absentes) ; **Maillon 2** `providers/[id]/page.tsx` — ajoute `searchParams` à la signature (Server Component, `params` **ET** `searchParams` sont des `Promise` en Next 16), lit `lat`/`lng`, construit un **suffixe** `coordsSuffix()` (`&lat=…&lng=…` **uniquement si les deux sont finis**, sinon `''`) passé en prop à `ServiceRow` → `href` « Demander » = `/requests/new?providerId=…&serviceId=…{suffixe}` ; **Maillon 3** `requests/new/page.tsx` (searchParams `lat`/`lng` ajoutés → props form, **même canal** que `providerId`/`serviceId`) + `create-request-form.tsx` — `parseCoord(lat)`/`parseCoord(lng)` (null si absent/vide/non-fini), **si les deux valides** → `serviceLocation = { type:'Point', coordinates:[lngNum, latNum] }` (⚠️⚠️ **FOOTGUN : longitude EN PREMIER** — GeoJSON `[lng, lat]` ; inverser enverrait la demande à l'autre bout du monde ; Québec/Laval : `lng ≈ -73` **négatif**, `lat ≈ 45` **positif**). **Comportement SANS coords = placeholder EN SURSIS** : `lat`/`lng` absents ou non-finis (entrée profil-direct / lien partagé Facebook) → le form **retombe sur `QUEBEC_SERVICE_LOCATION`**, balisé `// TODO 3.14c-2` — **le submit n'est JAMAIS bloqué** (préserve le Direct Profile Sharing, levier d'acquisition). Le placeholder **meurt sur le happy path**, **survit sur l'edge** le temps de 3.14c-2, sciemment. **Le cast `as unknown as CreateServiceRequestBody['serviceLocation']` RESTE** dans les deux branches (quirk *nullable* JSONB §6 — le type généré dégrade le GeoJSON en `Record<string, never>` ; **on remplace la SOURCE — placeholder → coords URL — pas le cast** ; dette *nullable* **non soldée ici**). **Frontière stricte** : 3.14c-1 s'arrête au thread happy path — **pas** de capture in-form (champ adresse/géoloc dans le form = 3.14c-2), **pas** de solde du quirk nullable. **`parseCoord` local dupliqué** dans `providers/[id]/page.tsx` et `create-request-form.tsx` (mirror du helper de `recherche/page.tsx`) — cohérent avec le pattern maison (helpers co-localisés, extraction DRY = dette suivie). **Fichiers modifiés (5, tous front)** : `recherche/_components/provider-card.tsx`, `recherche/page.tsx`, `providers/[id]/page.tsx`, `requests/new/page.tsx`, `requests/new/create-request-form.tsx`. **Vouvoiement** ; **aucun texte utilisateur nouveau** (thread invisible). **Auth/`proxy.ts`/`PUBLIC_PAGES` non touchés** ; pages **privées** sous `(app)` (gardes `getCurrentUser()` inchangées). **Anti-objectifs respectés** : zéro backend/migration/DTO/POST-API, pas de capture in-form, submit **non bloqué** sur absence de coords, quirk nullable **non soldé** (cast conservé), **lat/lng jamais inversés** (`[lng, lat]`), doublon `dashboard/requests/[id]` & nav « Trouver un pro » **non touchés**, pas d'état persisté/cookie/store (URL seul canal). **Validé** : `pnpm --filter @linkr/web` **typecheck + lint + build VERTS** (`/providers/[id]`, `/recherche`, `/requests/new` listées `ƒ` dynamiques, aucune collision) ; **schéma inchangé** (aucun backend touché → diff `openapi.json`/`schema.d.ts` **VIDE**, conforme au slice front pur). **Smoke navigateur + vérif SQL en base = HUMAIN** sur la stack Docker (`:3001`/`:5000`, 3 vars Nominatim requises au boot) : happy path `/recherche` → Coiffure → adresse « Laval, Quebec » → candidat Laval → cartes (URL `?…&lat=45.6…&lng=-73.7…`) → carte → profil (`/providers/{id}?lat=45.6…&lng=-73.7…`) → « Demander » (`/requests/new?providerId=…&serviceId=…&lat=45.6…&lng=-73.7…`) → soumettre → **en base `service_requests` la dernière ligne doit avoir `ST_X ≈ -73.7` (lng, négatif) / `ST_Y ≈ 45.6` (lat, positif)** = **Laval, pas le placeholder Québec `-71.21/46.81`** (le test qui compte ; `lng` négatif = anti-inversion) ; edge profil-direct `/providers/{id}` **sans** `?lat=&lng=` → « Demander » → URL sans lat/lng → submit **passe** → `serviceLocation` = placeholder Québec (attendu, toléré, sursis 3.14c-2). **Dettes** (cf. §6) : placeholder `serviceLocation` **partiellement soldé** (happy path mort ; edge profil-direct → 3.14c-2 capture in-form) ; quirk *nullable* JSONB (cast) **toujours ouvert** ; nav « Trouver un pro » vs « Rechercher » **ouverte** (liée à 3.14c-2). **Utilisateur de test purement client** : `carol@linkr.test`.
**3.14c-2** — RÉSOLU : capture in-form livrée (PR #48) — le formulaire géocode serviceAddress au submit via le relais BFF GET /api/geocode ; le placeholder ne survit plus que sur échec de géocodage, zéro candidat, ou « Aucune de ces adresses » (service_location restant NOT NULL).
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
