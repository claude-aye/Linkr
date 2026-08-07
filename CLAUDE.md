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
- **Notifications — providers `ORGANIZATION` hors du jeu de lecture** (dette ouverte, PR B) : `GET /notifications` résout les profils de l'appelant en mirroitant `findByUserId` (**INDIVIDUAL** seul), parce qu'**aucune** voie backend ne résout user → les providers ORGANIZATION qu'il possède — l'appartenance ne se parcourt qu'en sens inverse (`assertActiveOwner` → `findActiveByOrgAndUser` : une **vérification**, pas un **listing**). Or `findEligibleProviderIds` **ne filtre pas `provider_type`** : un provider ORGANIZATION **peut déjà détenir** des `NEW_TENDER_MATCH`, aujourd'hui illisibles par son OWNER. **Correctif** : une méthode de listing (user → providers ORGANIZATION dont il est OWNER actif) **dans le domaine `service-providers`**, puis élargir `RECIPIENT_PREDICATE` — jamais l'inverse, le module notifications n'est pas juge du RBAC organisationnel.
- **Pas de colonne `locality` — les notifications ne peuvent pas dire OÙ** (dette ouverte, relevée en PR B) : `service_requests` ne porte qu'un `service_address` **texte libre** (aucune colonne ville/localité nulle part dans l'API), donc le libellé de notification omet **toute** localisation. Servir l'adresse complète serait une exposition **nouvelle** (un destinataire de `NEW_TENDER_MATCH` est un match géographique, pas l'assigné, et ne peut pas lire la demande via `GET /service-requests/:id`, propriétaire-ou-ADMIN). **Correctif** : capturer une `locality` **au géocodage** (la couture `common/geocoding/` la reçoit déjà de Nominatim) et la joindre — coarse par construction, donc sans arbitrage Loi 25 à refaire.
- **`updateReturningRows()` dupliqué par repository** (dette de forme, pré-existante, **élargie d'une copie** en PR B) : le quirk TypeORM `UPDATE … RETURNING → [rows, affected]` est neutralisé par un normaliseur **local** recopié dans `payment`, `refund`, `quote`, `stripe-connect` et désormais `notifications`. Ce n'est pas cosmétique — sans lui, `rows.length` vaut 2 sur **zéro** ligne touchée, donc une garde d'appartenance en `WHERE` répond 200 au lieu de 404. **Correctif** : un helper partagé (`common/typeorm/`), chore dédié.
- **`users.verification_level` jamais écrit — vérification d'identité progressive NON implémentée** (dette ouverte, cf. §8.1) : la colonne et l'enum (`NONE → EMAIL → PHONE → IDENTITY`) existent, **aucun chemin de code ne les écrit** (pas d'OTP SMS, pas de dépendance d'envoi, aucun DTO de mise à jour ne l'expose) → valeur `NONE` à vie pour tous les users. La garde `PHONE`/`IDENTITY` sur `POST /service-providers` (et l'exception `PhoneVerificationRequiredException`) a été **retirée** : elle rendait la route inatteignable. **À livrer ensemble, jamais séparément** : OTP SMS (envoi + vérification + écriture de la colonne) **puis** remise de la garde. Une garde posée avant l'OTP est un cul-de-sac, où qu'on la place. La colonne porte un `COMMENT` SQL qui le dit (migration `1780460000000-CommentVerificationLevelNotEnforced`, miroir sur l'option `comment` de l'entité — sans ce miroir, la prochaine `migration:generate` voudrait retirer le commentaire).
- **Plugin Swagger non activé dans `nest-cli.json`** (dette connue, hors périmètre) : tout DTO sans `@ApiProperty` explicite se génère **vide** dans `openapi.json`. **Le contrat est donc moins fiable que le source** — ne pas s'en servir comme preuve d'un comportement.
- **Localisation figée à l'inscription — `QUEBEC_LOCALE_DEFAULTS`** (dette **produit** ouverte, PR « Inscription web ») : `countryCode`/`subdivisionCode`/`preferredCurrency` sont **requis par `SignupDto`** mais **jamais demandés à l'utilisateur** — figés `'CA'`/`'CA-QC'`/`'CAD'` dans **une seule constante nommée**, côté serveur, dans `apps/web/src/app/api/auth/signup/route.ts` (elle porte son `TODO`). **Le modèle de données est déjà international** (ISO 3166-1/-2, ISO 4217, `regulatory_requirements` par tuple pays/subdivision) ; **seul ce défaut ne l'est pas**. Le jour où Linkr sort du Québec, les 3 champs deviennent des choix utilisateur (sélecteur au formulaire) — **un seul endroit à changer**, à condition de ne jamais les ré-éparpiller dans le composant client. Concerne **uniquement** l'inscription par courriel : le chemin OAuth applique déjà les mêmes défauts Québec en dur dans `AuthService.handleOAuthCallback` (à traiter **en même temps**).

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

**Progressive Identity Verification State Machine (⚠️ DECLARATIVE ONLY — NOT IMPLEMENTED):**
```
NONE → EMAIL → PHONE → IDENTITY
```
- `users.verification_level` exists as a column and as an enum, **but no code path ever writes it**: there is no SMS OTP, no sending dependency, no update DTO exposing it. It stays at `NONE` for every user, forever. The column carries a SQL `COMMENT` saying so (migration `CommentVerificationLevelNotEnforced`, mirrored by the entity's `comment` option).
- **No guard depends on it.** The provider-creation gate that required `PHONE`/`IDENTITY` was removed: it referenced an unreachable state, so `POST /service-providers` was a dead end and every existing provider had been inserted by hand. **Product decision: creating a provider profile requires no verification level.** The phone requirement comes back **with** the OTP, never before — a guard on an unreachable state is a dead end wherever it is placed.
- Access to money is protected elsewhere and is untouched: `assertPayable` blocks the OPEN→ASSIGNED transition until the provider's Stripe Connect account has `charges_enabled`, and Stripe runs its own KYC.
- The intended-but-unbuilt semantics, for whoever implements OTP: phone verification required to activate Pro mode; `IDENTITY` reached after Stripe Connect Express KYC completion.

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
**3.14c-2** — RÉSOLU : capture in-form livrée (PR #48) — le formulaire géocode `serviceAddress` au submit via le relais BFF `GET /api/geocode`. **La formulation précédente de cette entrée était fausse** : elle ne décrivait que la branche « sans coords d'URL ». Tant que l'URL portait `lat`/`lng` (le cas normal après une recherche), le submit postait **ces** coords sans jamais géocoder l'adresse tapée — l'adresse était exigée puis ignorée (jusqu'à 245 km d'écart mesuré en base entre le texte et le point stockés). Or `lat`/`lng` d'URL localisent **où le client a cherché un prestataire**, pas **où le service aura lieu**. **Corrigé** : la branche coords-d'URL est **supprimée**, le géocodage de l'adresse tapée est le **chemin unique** (les deux portes — résultat de recherche et lien partagé — se comportent identiquement) ; les coords d'URL deviennent un **repli**, atteignable seulement derrière « Envoyer quand même » (props renommées `searchLat`/`searchLng` dans `requests/new` pour encoder ce sens ; **noms des paramètres d'URL inchangés**). Échelle de dégradation explicite : **adresse géocodée › zone de recherche › placeholder Québec** — ce dernier ne subsiste que sans coords d'URL (lien partagé), après échec de géocodage, zéro candidat, ou « Aucune de ces adresses » (`service_location` restant NOT NULL). Invariant PR #52 préservé : un seul site d'appel au placeholder, dans `submitAnyway`. Dette ouverte : `location_is_approximate` (le libellé du panneau ne distingue pas les deux replis).
**3.14d** — rationalisation nav (SOLDÉE) : le stub /providers (3.13-PR2, « Bientôt disponible ») est supprimé ; « Trouver un pro » pointe désormais sur /recherche (nav et hub). /providers/{id} (profil prestataire, 3.13) intact. La redondance « Trouver un pro » vs « Rechercher » n'existe plus.
**Inscription web** (front, web only — la porte d'entrée s'ouvre) : **page `/signup` + Route Handler BFF `POST /api/auth/signup`**. `POST /auth/signup` existait et fonctionnait côté API depuis 3.4 ; ce qui manquait était **le moyen de l'atteindre depuis un navigateur** — créer un compte exigeait un client HTTP en ligne de commande, ce qui bloquait **les deux côtés du marché** (ni client, ni prestataire ne pouvait entrer). **SLICE FRONT PUR : zéro backend, zéro migration, diff `openapi.json`/`schema.d.ts` VIDE** (`apps/api` **non touché**, aucun fichier). **Le BFF est le JUMEAU de `api/auth/login`** : mêmes noms de cookies (`linkr_at`/`linkr_rt`), **mêmes options** (`baseCookieOptions` + `ACCESS_MAX_AGE`/`REFRESH_MAX_AGE` — le bloc cookie est une copie mot pour mot), même réponse `{ user }` (**les jetons ne repassent JAMAIS au navigateur**), même `fetch` serveur-à-serveur documenté (l'OpenAPI déclare le body auth vide → le client typé ne peut pas le porter), même repli 502. **Vérifié à la source (l'`openapi.json` n'est pas fiable ici — plugin Swagger non activé)** : `POST /auth/signup` renvoie **`AuthResponseDto` = `{ accessToken, refreshToken, user }`, STRICTEMENT identique à `login`** → **décision produit : l'inscription CONNECTE immédiatement** (aucun second écran de mot de passe quinze secondes plus tard) ; la page atterrit sur `/` comme une connexion. **Deux différences relevées et assumées** : (1) `signup` répond **201** (pas de `@HttpCode`, contrairement au `@HttpCode(200)` de `login`) — le test `.ok` couvre les deux, et le handler répond **200** pour que sa *forme* colle à celle de `login` ; (2) **le 409 est RELAYÉ tel quel** — `AuthService.signup` lève `ConflictException('Email already registered')`, seul cas que la page doit savoir expliquer (« ce courriel a déjà un compte → connectez-vous », avec le lien) ; `login`, lui, écrase tout non-5xx en 401, ce qu'on ne peut pas faire ici sans perdre l'information. **DETTE PRODUIT TRAÇABLE — les 3 champs de localisation** : `countryCode`/`subdivisionCode`/`preferredCurrency` sont **REQUIS par `SignupDto`** mais **jamais demandés à l'utilisateur** → figés `'CA'`/`'CA-QC'`/`'CAD'` dans **UNE SEULE constante nommée côté serveur**, `QUEBEC_LOCALE_DEFAULTS` (dans le Route Handler), portant le **TODO** « Québec-only launch. These become user-selected when Linkr opens beyond QC. The data model is already international; only this default is not. » — **aucune valeur éparpillée dans le composant client**, un seul endroit à changer le jour venu (cf. §6). `languagePreference` **volontairement absent** (optionnel au DTO, l'API le défaute déjà à `fr-CA`). **Le payload est assemblé CHAMP PAR CHAMP, jamais spreadé depuis le corps entrant** : l'API tourne avec `ValidationPipe({ forbidNonWhitelisted: true })`, donc toute clé parasite ferait **400 l'inscription entière** — et `phone`/`displayName`/`languagePreference` ne doivent pas être pilotables depuis le navigateur (**prouvé au runtime** : un POST injectant `countryCode:'FR'`, `preferredCurrency:'EUR'`, `displayName:'HACKED'`, `phone`, `junk` passe en **200** avec en base `CA`/`CA-QC`/`CAD` et `display_name = NULL`). **Page** `(auth)/signup/page.tsx` — Client Component calqué sur `(auth)/login/` (structure, `fieldClass`/`labelClass`, bouton, `role="alert"`, `router.push('/') + router.refresh()`), **4 champs et rien d'autre** : prénom, nom, courriel, mot de passe. **Pas de confirmation de mot de passe, pas de téléphone** (optionnel au DTO, et l'OTP n'existe pas — cf. dette `verification_level`). `autoComplete` corrects (`given-name`/`family-name`/`email`/**`new-password`** — et non `current-password`, pour que les gestionnaires proposent un mot de passe généré au lieu d'auto-remplir un identifiant existant), `<label htmlFor>` réels (**jamais un placeholder en guise de label**), hint `aria-describedby` sur la longueur minimale. **Validation client = MIROIR du DTO** (mot de passe ≥ 8 et ≤ 128, prénom/nom 1–100) — elle **ne remplace pas** la validation serveur, elle évite un aller-retour perdu. **Mapping FR par code HTTP SEUL** (verrou 3.12b — le corps n'est jamais parsé pour choisir un message), **vouvoiement** : **409 → « Un compte existe déjà avec ce courriel. » + lien « Connectez-vous. »** (le seul message qui dit **quoi faire**), 400 → « Certains champs sont invalides… », défaut (502/réseau) → « Service momentanément indisponible… » (**distinct** du 409). **Lien dans CHAQUE sens** : « Vous avez déjà un compte? » → `/login` sur la page d'inscription, et son symétrique « Vous n'avez pas de compte? » → `/signup` ajouté en bas de `(auth)/login/page.tsx` (**seule** modification de cette page — le flux de connexion, `logout` et le rafraîchissement sont **intacts**) ; une page d'inscription atteignable uniquement en tapant l'URL ne sert à rien. **`proxy.ts` — `PUBLIC_PAGES = ['/login', '/signup']`** : ajout **indispensable, non cosmétique** — sous le deny-by-default, un visiteur anonyme (c.-à-d. **exactement** celui qui en a besoin) était renvoyé vers `/login` et la page restait atteignable seulement par un compte déjà existant. Le BFF n'a besoin d'aucune entrée : `/api/auth/signup` tombe déjà sous `PUBLIC_API_PREFIX`. **Effet de bord hérité (non introduit ici)** : un utilisateur déjà connecté qui vise `/signup` est renvoyé vers `/dashboard` (branche « bonus-UX » existante de l'étape 2 du proxy), alors que la connexion, elle, atterrit sur `/` — **incohérence pré-existante de `/login`, non corrigée** (hors périmètre). **Validé** : `pnpm --filter @linkr/web` **typecheck + lint + build VERTS** (`/signup` listée `○` statique comme `/login`, `/api/auth/signup` listée `ƒ`, aucune collision). **Smoke END-TO-END RÉEL exécuté** (Postgres 16 + PostGIS 3.4 + Redis montés localement, API `:5000` + web `:3001`, migrations passées) : `/signup` anonyme → **200** (et non plus une redirection) ; inscription → **200 `{user}` sans jetons** + **`Set-Cookie` `linkr_at`/`linkr_rt`** dont les attributs sont **byte-identiques** à ceux de `login` (`Path=/; Max-Age=900|604800; HttpOnly; SameSite=lax`, diff vide) ; les cookies obtenus rendent le hub `/` (« Bonjour, Grace ») = **compte créé ET connecté** ; courriel dupliqué → **409** sans cookie ; mot de passe à 7 caractères / courriel malformé / champ manquant → **400** sans cookie ; en base : `users` en `CA`/`CA-QC`/`CAD`/`fr-CA`, `user_auth_providers` en `EMAIL_PASSWORD` avec un hash `$argon2id$`. **Anti-objectifs respectés** : zéro fichier `apps/api`, flux login/logout/refresh non touchés (hors le lien ajouté), profil prestataire (PR 3) non abordé, nav/hub/dashboard non touchés, aucune couleur/espacement/composant nouveau (tout est repris de la page de connexion).
**Devenir prestataire (web)** (front, web only — le maillon du milieu) : **page `/providers/new` + Route Handler BFF `POST /api/service-providers` + état vide du tableau de bord transformé en porte d'entrée**. `POST /service-providers` était atteignable depuis la PR #56 (garde `verification_level` retirée) et un humain pouvait créer un compte depuis la PR #57 ; il manquait **l'interface qui crée le profil prestataire** — cela exigeait encore un client HTTP en ligne de commande. **SLICE FRONT PUR : zéro fichier `apps/api`, zéro migration, diff `openapi.json`/`schema.d.ts` VIDE.**
> **⚠️ DIVERGENCE DE RÈGLE ASSUMÉE — NE PAS « CORRIGER » L'INCOHÉRENCE.** Le formulaire de demande (`create-request-form.tsx`, 3.14c-2) **ne bloque JAMAIS** le submit : il dégrade (adresse géocodée › zone de recherche › placeholder Québec) parce qu'un client bloqué est un client perdu et que quelqu'un attend à l'autre bout. **Ce formulaire-ci BLOQUE** : sans coordonnée que l'utilisateur a **vue et choisie**, rien n'est posté. La raison est métier, pas stylistique — `service_base_location` décide **dans quelle ville le prestataire apparaît** (`ST_DWithin` de `discover`) ; un repli silencieux le publierait au mauvais endroit, **invisible pour ses vrais voisins et proposé à des clients à 250 km**, sans rien à l'écran pour le révéler. Personne n'attend, et il peut reformuler. Donc : **aucun repli, aucun placeholder, aucun « Envoyer quand même »** — les seules issues sont « Corriger l'adresse » (`no-match`) ou « Réessayer » (`unavailable`). Les deux règles sont justes **chacune dans son contexte** ; les aligner casserait l'un des deux.
**Chaîne de géocodage RÉEMPLOYÉE, pas réécrite** : même relais BFF `app/api/geocode/route.ts` (**non touché**), mêmes types générés `GeocodeCandidateDto`/`GeocodeResultDto`, même désambiguïsation par liste de candidats. Le transport + la classification à 3 issues (`candidates` / `no-match` / `unavailable`) sont **extraits** dans `lib/geocoding/geocode-address.ts` (`geocodeAddress()`), nouveau **joint partagé** ; la **politique** (bloquer vs dégrader) reste dans chaque formulaire. **Dette tracée, NON corrigée** : `create-request-form.tsx` garde sa copie inline du transport — la faire converger sur ce module reviendrait à toucher sa logique de dégradation, hors périmètre ; `lib/geocoding/` est l'endroit où elle doit converger. **BFF** `app/api/service-providers/route.ts` — frère des relais de mutation existants (cookie d'accès via `getServerApiClient()`, relais transparent du statut/corps, 502 sur échec transport), avec **deux écarts délibérés vs le tube pur de `api/service-requests`** : (1) le corps est **assemblé champ par champ, jamais spreadé** — `providerType` est **FIGÉ à `'INDIVIDUAL'`**, `organizationId` n'est **jamais** relayé (interdit pour un INDIVIDUAL, l'API 400), `headline`/`bio` non pilotables depuis le navigateur, et sous `forbidNonWhitelisted: true` toute clé parasite ferait 400 la création entière ; (2) le **Point GeoJSON est CONSTRUIT côté serveur** à partir de deux nombres (`lat`/`lng`) — le footgun **`[longitude, latitude]`, longitude D'ABORD** n'a ainsi **qu'un seul site** dans ce chemin et un Point malformé ne peut pas être posté depuis le navigateur. Le **409** (`ProviderOwnerConflictException` — cet utilisateur a déjà un prestataire actif) est **relayé tel quel** : c'est le seul cas que la page doit savoir expliquer (« Vous avez déjà un profil prestataire. » + lien « Voir mon tableau de bord. »). **Page** `(app)/providers/new/` — segment statique `new` **à côté** du `[id]` public (le statique gagne dans l'App Router, aucune collision ; même forme que `/requests/new`). Server Component : garde `getCurrentUser()` → `redirect('/login')` **HORS try/catch**, résout le **nom suggéré** ; le Client Component porte le géocodage et le POST (**PAS de Server Action** — cohérent avec tout l'existant). **3 champs** : `businessName` (**optionnel au DTO mais demandé** — sans lui la carte de découverte n'affiche que « Prestataire » → **pré-rempli** depuis l'identité de session, librement modifiable et effaçable : une **suggestion**, pas une imposition ; vide → **omis du payload**, jamais `''`), adresse de base (géocodée, bloquante), `serviceRadiusKm` (**entier, défaut 25, min 0** — 0 = couverture par zones nommées seules). `headline`/`bio` **hors périmètre**. **Mapping FR par code HTTP SEUL** (verrou 3.12b), vouvoiement : 409 (+ lien), 400, 401, défaut 502/réseau. **Après succès** : `router.push('/dashboard') + router.refresh()` — **motif exact des pages login/signup**, aucune redirection réinventée ; `pending` **reste vrai** pendant la navigation (un second envoi serait voué au 409). **Phrase d'honnêteté** au pied du formulaire : le profil sera **actif immédiatement** (`is_active` codé `true` par l'API) mais **pas encore découvrable** (la découverte matche sur un métier déclaré) — **aucune promesse** d'une étape suivante : déclarer un métier n'a pas encore d'interface (PR 4). **Tableau de bord** : l'état vide (branche `notPro`) devient `BecomeProviderCard` (même coquille que `StateCard`, laissé intact pour la branche `failed`, + le style de bouton primaire déjà employé ailleurs) avec un CTA vers `/providers/new`. **La détection n'ajoute AUCUN appel réseau** : c'est le **404 de `GET /service-providers/me` déjà effectué** par la page. **Cas nominal intact** (un prestataire existant voit son tableau inchangé). **Hub `/`** : **troisième carte « Devenir prestataire → »** à côté de « Trouver un pro » et « Mes demandes », rendue **uniquement si `!isProvider`** — l'exact **miroir** du raccourci « Accéder à mon tableau de bord prestataire » déjà rendu, lui, si `isProvider` (un utilisateur voit l'un **ou** l'autre, jamais les deux). Elle **réemploie le composant `HubCard` existant** (la flèche « → » vient du motif, pas d'un ajout) et **reste dans la grille `sm:grid-cols-2`** : elle s'écoule en 2ᵉ rangée — **aucune classe, aucune couleur, aucun espacement nouveau**, et pas de bascule en `grid-cols-3` qui rétrécirait les cartes existantes. **AUCUN appel réseau ajouté, et le point mérite d'être écrit** : le hub `await getShellCapabilities()` **déjà** (ligne 1 du composant) — la carte lit la **négation d'une valeur déjà déstructurée**. `GET /service-providers/me` garde **exactement deux sites d'appel** (`lib/nav/capabilities.ts`, partagé par le layout **et** le hub ; `dashboard/page.tsx`) : **pas de troisième**, la dette tracée en 3.13-PR2 n'est pas aggravée. **Mesuré, pas déduit** : en comptant les requêtes `FROM service_providers` déclenchées par un rendu du hub, **1 avant la modification, 1 après** (protocole `git stash` + rebuild + rendu, cf. smoke). *Info relevée au passage (non exploitée, non « corrigée »)* : ce compteur à **1** — et non 2 — montre que le double appel layout+hub documenté en 3.13-PR2 est **de fait fusionné à l'exécution** par la mémoïsation de requête de Next ; la dette reste écrite telle quelle, sa factorisation (`react/cache`) n'ayant pas été entreprise ici. **a11y** : `<label htmlFor>` réels, hints `aria-describedby`, région `aria-live="polite"` **unique** pour les deux issues du géocodage (présente dans le DOM même vide — une région insérée en même temps que son contenu n'est souvent pas annoncée), erreurs en `role="alert"`, `scrollIntoView({ block: 'start' })` (et **non `'center'`** : clavier virtuel ouvert, le viewport ne rétrécit pas et « centre » tombe derrière le clavier). **Validé** : `pnpm --filter @linkr/web` **typecheck + lint + build VERTS** (`/providers/new` et `/api/service-providers` listées `ƒ`, aucune collision avec `/providers/[id]`). **Smoke END-TO-END RÉEL exécuté** (Postgres 16 + PostGIS 3.4 + Redis montés localement, migrations passées, API `:5000` + web `:3001`, **navigateur Chromium**) — Nominatim étant **injoignable depuis le sandbox** (403 CONNECT de l'agent-proxy, cf. 3.14b-back), un **stub local jetable** a tenu son rôle le temps du test, l'API pointée dessus par `NOMINATIM_BASE_URL` : tableau de bord vide → CTA visible → `/providers/new` (nom suggéré pré-rempli, rayon `25`) ; **adresse ingéocodable** → panneau `no-match`, **toujours sur le formulaire**, **AUCUN « Envoyer quand même »**, « Corriger l'adresse » offert, et **rien créé en base** ; **adresse géocodable** → liste de 2 candidats, **toujours rien posté avant le choix**, clic sur le **2ᵉ** candidat → « Localisé : Laval-des-Rapides… » → submit → `/dashboard` (CTA disparu, « Bonjour, Test Provider ») ; **en base** : `ST_X = -73.7010` / `ST_Y = 45.5540` = **exactement le candidat CHOISI** (le 2ᵉ, pas le 1ᵉʳ), **longitude négative** (anti-inversion), rayon `40`, `is_active = t`, **une seule** ligne prestataire pour cet utilisateur. Au curl : 201 ; **doublon → 409** ; corps malformés (`lat` string, `serviceRadiusKm` absent, `businessName` non-string, JSON invalide) → **400** ; **non authentifié → 401 JSON** (proxy deny-by-default) ; **injection prouvée neutralisée** — un POST portant `providerType:'ORGANIZATION'`, `organizationId`, `headline:'HACKED'`, `bio:'HACKED'`, `junk` **passe en 201** avec en base `INDIVIDUAL` / `organization_id NULL` / `headline NULL` / `bio NULL` (le `junk` est **écarté** à l'assemblage au lieu de 400 la création — preuve du champ-par-champ) ; `serviceRadiusKm: 25.5` → **400 de l'API** (« must be an integer number »). **Anti-objectifs respectés** : zéro fichier `apps/api`, déclaration de métier/catégories (PR 4) non abordée, Stripe Connect non touché, `create-request-form.tsx` et sa dégradation **non modifiés**, nav/hub/`/recherche` non touchés, aucune couleur/espacement/composant nouveau. **Dettes relevées et NON corrigées** : (1) la copie inline du transport de géocodage dans `create-request-form.tsx` (ci-dessus) ; (2) `/providers/new` **ne pré-vérifie pas** qu'un profil existe déjà (ce serait un **3ᵉ** site d'appel à `/service-providers/me` — le layout et le dashboard en font déjà deux, dette connue) : le 409 mappé porte le cas ; (3) le repli 502 des BFF reste **tutoyant** (« Réessaie plus tard. ») alors que le mapping client vouvoie — divergence héritée, inchangée.
**Déclarer un métier (web)** (front, web only — **le dernier maillon : le prestataire devient DÉCOUVRABLE**) : **section « Mes métiers » sur le tableau de bord + Route Handler BFF `POST /api/service-providers/{providerId}/categories`**. `POST /service-providers/:providerId/categories` existait depuis 3.7 ; il manquait **l'interface**, sans quoi un prestataire créé (PR #58) n'apparaissait dans **aucune** recherche — le prédicat de `discover` exige une catégorie déclarée. **SLICE FRONT PUR : zéro fichier `apps/api`, zéro migration, diff `openapi.json`/`schema.d.ts` VIDE.**
> **⚠️ LES MÉTIERS RÉGLEMENTÉS SONT PRÉSENTÉS MAIS NON SÉLECTIONNABLES — DÉCISION PRODUIT VERROUILLÉE, NE PAS « ACTIVER ».** Côté serveur (`provider-services.service.ts`, la condition **relevée, pas déduite**) : `const status = category.regulationLevel === RegulationLevel.INFORMAL ? PscVerificationStatus.NOT_REQUIRED : PscVerificationStatus.PENDING;` — binaire strict, **INFORMAL → `NOT_REQUIRED`** (éligible immédiatement, **aucun administrateur dans la boucle**), **tout le reste (REGULATED) → `PENDING`**. Or sortir de `PENDING` exige un téléversement de licence approuvé par un admin — hors périmètre **et de fait bloqué** (un admin ne peut même pas afficher le document qu'on lui demande d'approuver, cf. dette BFF file-proxy 3.11c-A). Une déclaration réglementée resterait donc **`PENDING` à vie, sans issue** : activer ces options fabriquerait un cul-de-sac de plus. **Prouvé au runtime** (stack réelle) : déclarer Plomberie **réussit en 201 avec `PENDING`** et le prestataire reste **`total: 0`** dans `discover` — déclaré et pourtant invisible. Elles sont **montrées plutôt que masquées** : un plombier qui ne trouve pas son métier conclut que Linkr ne le couvre pas ; grisé, il comprend qu'il doit attendre. Le motif de désactivation voyage **sur le libellé de l'`<option>`** (« — vérification de licence requise, bientôt disponible ») et non seulement dans le hint : une option désactivée est annoncée avec son propre texte, c'est ce qu'un lecteur d'écran restitue.
**Le niveau de réglementation vient du CATALOGUE, jamais d'une liste en dur** : `GET /service-categories` (`@Public()`) → `listPublicCategories()` → `findActivePublic()` = un `find()` **sans aucune projection**, et l'API n'installe **aucun `ClassSerializerInterceptor`** → l'entité `ServiceCategory` **entière** est sérialisée, `regulationLevel` compris. **Vérifié au runtime, pas supposé** : les 7 catégories du seed Québec reviennent annotées (Plomberie/Électricité/Menuiserie `REGULATED`, Coiffure/Esthétique/Décoration/Homme à tout faire `INFORMAL`). Une liste figée dans le front mentirait le jour où le seed change. **Typage** : ce endpoint n'a **aucun schéma de réponse** (`content: never`) → le miroir minimal **existant** `CategoryOption` (`lib/providers/discovery-types.ts`, déjà utilisé par `/recherche`) est **ÉTENDU** d'un champ `regulationLevel` — **un seul miroir par endpoint**, partagé par les deux sélecteurs, pour qu'ils ne puissent pas diverger ; l'union est **DÉRIVÉE** du schéma généré (`CreateServiceCategoryDto['regulationLevel']`, seul endroit où le contrat épelle l'énum) et non écrite à la main. **`GET /service-providers/{providerId}/categories`** (vue propriétaire, tous statuts, soft-deleted exclus, `createdAtUtc ASC`) est **aussi** `content: never` **et** son DTO n'est **même pas émis** dans `components.schemas` → miroir **complet** `ProviderCategory` dans `lib/providers/types.ts` (seule l'union `PscVerificationStatus` est dérivée, via `DiscoveredProviderDto`). ⚠️ Ce DTO porte `serviceCategoryId` (UUID) et **AUCUN libellé** → le nom du métier est **joint côté page** contre le catalogue déjà chargé pour le `<select>` (`Map` id → `pickTranslation`), UUID conservé en `title` au survol (motif des cartes de demande) ; catégorie absente du catalogue → `—`, jamais une explication inventée. **BFF** `app/api/service-providers/[providerId]/categories/route.ts` — frère des relais de mutation (cookie via `getServerApiClient()`, relais **transparent** du statut/corps, 502 sur échec transport, jamais de log du token). Corps **assemblé champ par champ, jamais spreadé** : le DTO n'a qu'un champ, mais sous `forbidNonWhitelisted: true` **une seule clé parasite ferait 400 la déclaration entière** — **injection prouvée neutralisée** au runtime (un POST portant `verificationStatus:'VERIFIED'`, `isActive:false`, `junk` **passe en 201** et la ligne en base est `NOT_REQUIRED` / `is_active = t`, décidée par le serveur). **L'ownership n'est PAS revérifiée ici, délibérément** : `providerId` vient du navigateur et l'API est **seule juge** (`loadOwnedProvider` → 404 inexistant / 403 non-propriétaire) ; la revérifier ajouterait un site d'appel et un second avis plus faible sur le RBAC. **Le cas qui compte = 409** : `ProviderCategoryConflictException` (prédicat `existsActive` = **toute** ligne non supprimée, donc un métier *en pause* 409 aussi) — **relayé tel quel**, mappé « Ce métier est déjà déclaré. Il figure dans la liste ci-dessus. » (dit quoi faire). Le `<select>` **ne filtre PAS** les métiers déjà déclarés : ce serait dupliquer côté client un prédicat serveur, avec dérive garantie. **Mapping FR par code HTTP SEUL** (verrou 3.12b), vouvoiement : 409, 404, 403, 400, 401, défaut 502/réseau. **Surface** : section **« Mes métiers »**, dont la position est **CONDITIONNELLE** — cf. l'encadré ci-dessous.
> **⚠️ L'ORDRE DES SECTIONS EST CONDITIONNEL — CE N'EST PAS UN RENVERSEMENT D'INBOX-FIRST.** Par défaut l'ordre est **« En attente de réponse » → « Mes jobs » → « Mes métiers »** : inbox-first est une **décision verrouillée** (3.12-front) et **elle ne bouge pas pour un prestataire établi**. **UNIQUEMENT** quand le prestataire a **ZÉRO métier déclaré**, « Mes métiers » **passe en tête**. La raison est causale, pas cosmétique : sans métier déclaré il est **invisible dans toute recherche**, donc les deux sections au-dessus ne peuvent **rien** dire d'autre que « aucune demande » / « aucun job » — la seule chose qui puisse changer ça est précisément la section qui l'explique. **Dès le premier métier déclaré la liste n'est plus vide et l'ordre verrouillé reprend**, sans autre condition. **Ne pas « simplifier » en figeant l'un des deux ordres** : figer l'inversion démote l'inbox d'un prestataire actif, figer l'inverse renvoie un prestataire neuf au bas de page pour la seule action qui le sorte de l'invisibilité.
> **Condition** : `trades !== null && trades.length === 0`, lue sur la donnée **déjà chargée** par la page — **aucun appel réseau ajouté**. Le `trades === null` (lecture en échec) **ne bascule PAS** : on ignore alors s'il a des métiers, et pousser l'inbox sous une carte d'erreur sur laquelle on ne peut pas agir échangerait une certitude contre une supposition. **Seul l'ordre de rendu change** — les trois sections sont construites **une seule fois** puis ordonnées ; zéro style, zéro composant, zéro balise nouvelle. Elles portent des **`key` stables** (`pending`/`jobs`/`trades`) : rendues depuis un tableau, sans clés stables React **reconstruirait** ce qui occupe un index au lieu de **déplacer** les sections — au moment exact de la bascule (déclaration du 1ᵉʳ métier → `router.refresh()`), `AddCategoryForm` serait remonté et **le message de succès que le prestataire vient d'obtenir disparaîtrait**. **Vérifié au navigateur** : la confirmation **survit** à la bascule. **État vide** : « Vous n'avez déclaré aucun métier. Sans métier déclaré, vous n'apparaissez dans aucune recherche… » — même principe que l'état vide qui l'a amené jusqu'ici. **Statut affiché = ce que la BASE contient**, jamais un espoir : `NOT_REQUIRED` → « Aucune vérification requise », `VERIFIED` → « Licence vérifiée », `PENDING` → « Vérification en attente », `REJECTED` → « Vérification refusée » ; **et `is_active = false` → « En pause »**, qui **prime** sur la vérification parce qu'une ligne inactive sort réellement du prédicat de découverte (vérifié : badge « En pause » ⟺ `discover` renvoie `total: 0`). **Familles de couleurs reprises** de `STATUS_BADGES` (emerald/amber/red/zinc) — **aucune couleur, aucun espacement, aucun composant nouveau** ; `TRADE_BADGES` est un const **LOCAL non exporté**, comme son voisin : la dette « helper de statut partagé » (3.13-B « VOIE 2 ») n'est **ni élargie ni payée** ici. **Après succès** : `router.refresh()` (motif de toutes les mutations) — le `<select>` est remis à vide et un message de confirmation **honnête** paraît : « Vous pouvez maintenant apparaître dans les résultats de recherche pour ce métier, **selon votre rayon de service et la position du client** » — on ne promet **pas** toutes les recherches. La confirmation célèbre, **le badge rafraîchi est la vérité**. **Deux lectures serveur ajoutées** (déclarations + catalogue), **dégradées CHACUNE dans sa propre section** et jamais dans le `failed` global : une panne du catalogue ne doit pas blanchir l'inbox. **a11y** : `<label htmlFor>` réel, hint en `aria-describedby`, région `aria-live="polite"` **présente dans le DOM même vide** (une région insérée en même temps que son contenu n'est souvent pas annoncée), erreur en `role="alert"`. **Validé** : `pnpm --filter @linkr/web` **typecheck + lint + build VERTS** (`/api/service-providers/[providerId]/categories` listée `ƒ`, aucune collision avec `/api/service-providers`). **Smoke END-TO-END RÉEL exécuté** (Postgres 16 + **PostGIS 3.4 installé dans le sandbox** + Redis, migrations + seed Québec passés, API `:5000` + web `:3001`, **navigateur Chromium**) : **avant déclaration `discover` = `total: 0`** ; Coiffure (INFORMAL) → **201 `NOT_REQUIRED`** → **`total: 1`, découvrable immédiatement, aucun admin** ; même métier à nouveau → **409** ; Plomberie (REGULATED) → 201 **`PENDING`** → **toujours `total: 0`** (le cul-de-sac, prouvé) ; au navigateur : état vide affiché, **options réglementées `disabled` confirmées** (3 grisées / 4 sélectionnables), sélection « Décoration » → submit → message de succès → **la ligne apparaît avec son vrai badge**, état vide disparu, `<select>` réinitialisé → re-soumission → **message 409 exact à l'écran** ; **ordre conditionnel prouvé sur les 3 branches** (ordre lu dans le HTML rendu) — 0 métier → `trades → pending → jobs`, ≥ 1 métier → `pending → jobs → trades`, et **lecture des métiers en échec → `pending → jobs → trades`** (pas de bascule), cette 3ᵉ branche forcée par un **proxy d'injection de faute** qui 500 la seule route `GET …/categories` (**même prestataire, même donnée** que la branche 1 : seul le résultat de la lecture diffère) ; **bascule live au navigateur** : `trades → pending → jobs` avant déclaration, `pending → jobs → trades` après, **confirmation de succès conservée** au travers du déplacement ; au curl sur `:3001` : non authentifié → **401 JSON** (proxy deny-by-default), JSON invalide / `serviceCategoryId` manquant → **400** du relais, non-UUID → **400 de l'API** relayé, provider inexistant → **404** relayé. **Anti-objectifs respectés** : zéro fichier `apps/api`, `/recherche` et le prédicat d'éligibilité **non touchés** (la PR les **prouve**, elle ne les modifie pas), téléversement de documents / console admin / Stripe Connect non abordés, `create-request-form.tsx` / hub / inscription / `/providers/new` non modifiés. **Dettes relevées et NON corrigées** : (1) **contrat** — les deux endpoints ci-dessus n'ont aucun `@ApiResponse` (`content: never`), d'où deux miroirs front ; le correctif backend est un `@ApiOkResponse({ type: ProviderCategoryResponseDto, isArray: true })` (**honnête** : le runtime renvoie bien un tableau nu) + le même pour `GET /service-categories`, patron 3.12a-back-fix ; (2) **pas d'UI de pause/retrait** d'un métier alors que `PATCH`/`DELETE …/categories/{pscId}` existent — le badge « En pause » sait déjà l'afficher, rien ne sait l'écrire ; (3) la dette « helper de statut partagé » entre dashboard et `/requests`, inchangée ; (4) le repli 502 des BFF reste **tutoyant**, divergence héritée.
**Notification de DIRECT_BOOKING (backend, PR A)** (**la table `notifications` cesse de ne connaître qu'un seul événement**) : **migration `1780470000000` + branche d'écriture ciblée `notifyDirectBooking()`**. Jusqu'ici la table n'avait **qu'un seul écrivain**, `broadcastTenderMatch()`, conditionné à `PROJECT_TENDER` — **une réservation directe ne notifiait personne** : le client choisissait un prestataire, la demande atterrissait `OPEN` dans sa file, et **rien** ne le lui disait. **La condition du broadcast n'est PAS touchée** : c'est un **fan-out géographique** vers tous les prestataires éligibles, exactement ce qu'un DIRECT_BOOKING ne doit **surtout pas** déclencher. On ajoute une branche **à côté**, jamais **dedans**. **ZÉRO front, ZÉRO route de lecture, ZÉRO canal externe, diff `openapi.json`/`schema.d.ts` VIDE** (aucun DTO ne change ; `notifications` n'est exposé par **aucune** route aujourd'hui).
> **⚠️ `notification_type` EST UN ENUM PG NATIF — `ALTER TYPE … ADD VALUE` NE SUFFIT PAS.** Constaté, pas supposé (`\dT+ notification_type` → *Internal name* `notification_type`, *Elements* `NEW_TENDER_MATCH` ; l'entité déclare `enumName: 'notification_type'`). Postgres **interdit** d'utiliser une valeur ajoutée par `ADD VALUE` **dans la même transaction** — et TypeORM enveloppe chaque migration dans une transaction. D'où la recette **rename-recreate** appliquée ici (`RENAME TO …_old` → `CREATE TYPE` à 2 labels → `ALTER COLUMN … TYPE … USING type::text::notification_type` → `DROP TYPE …_old`), **entièrement transactionnelle**. Si le type avait été un `varchar`, le problème n'existait pas — il l'était.
**Ce que la migration fait, et l'état constaté qui l'autorise** : (1) **`recipient_user_id` uuid NULL**, FK → `users(id)`, index partiel `WHERE … IS NOT NULL` ; sa clause **`ON DELETE RESTRICT` est ALIGNÉE** sur `fk_notifications_recipient_provider` (constaté `confdeltype = 'r'`) — **les deux FK existantes de la table concordent, aucune divergence à arbitrer** ; (2) **`recipient_service_provider_id` : NOT NULL → NULL** — posable **sans backfill**, `SELECT count(*) … WHERE recipient_service_provider_id IS NULL` = **0** ; (3) **`CHECK (num_nonnulls(recipient_user_id, recipient_service_provider_id) = 1)`** : « adressée à personne » et « adressée aux deux » deviennent **irreprésentables**, pas seulement non écrites (**prouvé** : les deux INSERT fautifs sont rejetés par la base) ; (4) enum **+ `NEW_DIRECT_BOOKING`** ; (5) **`COMMENT` sur `data`**. **`read_at_utc` n'est PAS ajouté — il EXISTAIT DÉJÀ** (migration d'origine `1780390000000:20`, miroité sur l'entité) ; l'item du plan était sans objet, constaté avant d'écrire.
**Le destinataire est généralisé maintenant, alors qu'aucun client n'est notifié aujourd'hui** : la ligne écrite ici s'adresse à un **prestataire** (`recipient_user_id` reste NULL). La colonne « user » est ouverte quand même pour que la table n'ait pas à être **remodelée** la première fois qu'il faudra dire quelque chose à un client (devis reçu, job démarré, solde libéré) — une bascule `NOT NULL → NULL` sur une table déjà pleine coûte plus cher qu'ici, où elle est gratuite (0 ligne concernée).
**`COMMENT` sur `data` — la règle, écrite dans la base** : « les identifiants vivent dans les colonnes, la lecture joint ; `data` est réservé à ce qui n'est **pas** joignable » (indice de rendu, instantané d'une valeur qui divergera légitimement de sa source). Un id dupliqué dans `data` est **une seconde source de vérité que rien ne synchronise**. Conséquence directe : la ligne DIRECT_BOOKING porte **`data: {}`** — destinataire et demande sont des FK. *(Le broadcast, lui, garde son `data` historique `{serviceCategoryId, title}` : **non touché**, hors périmètre.)*
**Les DEUX miroirs d'entité sont indispensables, et vérifiés** : `@Check('chk_notifications_single_recipient', …)` sur la classe **et** l'option `comment:` sur la colonne `data`. **Sans eux la prochaine `migration:generate` proposerait de les retirer** — vérifié en la lançant pour de vrai : la migration générée (jetée ensuite) **ne mentionne ni le CHECK, ni le commentaire, ni l'enum, ni un `ADD/DROP COLUMN` sur `notifications`**. *Info relevée au passage, non « corrigée »* : elle propose de renommer `fk_notifications_recipient_user` vers le nom auto-généré de TypeORM — **exactement le traitement qu'elle réserve aux ~20 FK nommées à la main du dépôt**, `fk_notifications_recipient_provider` compris ; ma FK se comporte comme ses sœurs, c'est une divergence de convention **pré-existante**, pas une régression introduite ici.
**`CreateNotificationData` : les deux destinataires sont des champs REQUIS** (`string | null`), pas optionnels — un nouveau site d'appel est ainsi **forcé de dire** à quel type de destinataire il s'adresse au lieu de laisser silencieusement les deux à `undefined`. `broadcastTenderMatch()` passe donc `recipientUserId: null` explicitement (**seule** modification de son corps). Nouvelle méthode repo **`insertOne()` — sans transaction** : une ligne est déjà atomique et, contrairement à `insertBatch()`, elle n'a **aucune ligne sœur** avec laquelle atterrir ; la construction d'entité est factorisée dans un `toEntity()` privé partagé par les deux chemins.
**Confinement d'erreur CALQUÉ, jamais réinventé** : `notifyDirectBooking()` **signale par un `throw`** (comme `broadcastTenderMatch()`, qui rollback puis relance) ; le confinement vit **au site d'appel**, `service-requests.service.ts` — appel **non-`await`é** + `.catch()` qui **logge** (`this.logger.error`), copie exacte du bloc voisin posé **après** le commit de la demande. **Prouvé au runtime, pas déduit** : un **trigger PG jetable** forçant l'échec de l'INSERT `NEW_DIRECT_BOOKING` → la demande répond quand même **201 / `OPEN`**, est **persistée**, **zéro** notification, et l'échec apparaît dans le log (`notifyDirectBooking failed for request 47678337… : QueryFailedError: smoke: …`). **Une notification qui échoue ne fait jamais échouer la demande.**
**Garde redondante ASSUMÉE** : la condition `requestedServiceProviderId != null` est posée **au site d'appel ET dans la méthode** (qui `warn` + `return` sinon). La méthode reste ainsi sûre pour elle-même et **ne peut pas écrire une ligne violant le CHECK**, quel que soit son futur appelant.

> ⚠️ **PIÈGE DE PLOMBERIE, DÉJÀ CONNU DU DÉPÔT, RE-MORDU ICI — `UPDATE … RETURNING`.** Le `.query()` brut de TypeORM sur le driver postgres renvoie **`[rows, affected]`** pour un `UPDATE` (le `RETURNING` peuple `rows`), là où un `INSERT`/`SELECT` renvoie le tableau de lignes **directement**. Conséquence non cosmétique : `rows.length` vaut **2 même quand zéro ligne a matché**, donc la lecture naïve répond **200 sur la notification d'autrui** au lieu de 404, et `rows[0].read_at_utc` est `undefined` → **500**. **Constaté au runtime, pas déduit** (5 endpoints en 500, `TypeError: Cannot read properties of undefined (reading 'toISOString')` dans le log). Le dépôt **savait déjà** : `payment`/`refund`/`quote`/`stripe-connect` portent **chacun sa copie locale** d'un normaliseur `updateReturningRows()` documenté. On **mirroite la même copie locale** — la factoriser en un helper partagé est un chore distinct, pas le travail de cette PR.
**Validé** : `pnpm --filter @linkr/api build` **vert** ; **jest 22/22 vert**. **Smoke END-TO-END RÉEL exécuté** (Docker **absent du sandbox** — `dial unix /var/run/docker.sock: no such file` ; Postgres 16 + **PostGIS 3.4 installé**, Redis montés localement, **migrations + seed Québec réellement passés**, API bootée sur `:5000`, `/health` `{database:up, redis:up}`) : inscription client + prestataire → création prestataire → déclaration Coiffure → **`POST /service-requests` DIRECT_BOOKING → 201** → en base **UNE seule ligne** `NEW_DIRECT_BOOKING`, `recipient_service_provider_id` = **le prestataire demandé**, `recipient_user_id` **NULL**, `data` = **`{}`** ; **contrôle PROJECT_TENDER → 201** → **2 lignes `NEW_TENDER_MATCH`** (le fan-out géo, **inchangé**) et **aucune** ligne direct-booking. **CHECK éprouvé dans les deux sens** (deux destinataires → rejet ; aucun → rejet ; destinataire *user* seul → accepté, la colonne que cette PR ouvre). **Aller-retour `up` → `down` → `up` complet** : le `down` restaure l'enum à un label, redonne `NOT NULL` (`attnotnull = t`), retire colonne/FK/index/CHECK/commentaire, et les 2 lignes `NEW_TENDER_MATCH` **survivent intactes**. **Le `down` SUPPRIME les lignes sans représentation** (`recipient_service_provider_id IS NULL`, et `type = 'NEW_DIRECT_BOOKING'`) : **seul endroit où la règle soft-delete (§13.1) ne peut pas s'appliquer** — le schéma reverti n'a **nulle part** où mettre la ligne, ni colonne ni label ; les deux DELETE sont **des no-ops** sur une base qui n'a jamais fait tourner le code que cette migration active. **Hors périmètre, non abordés** : route de lecture des notifications, front (cloche, badge non-lu), autres membres d'enum, tout canal externe (courriel/push — cf. §9 : ils passeront par BullMQ, jamais en synchrone). **Dette relevée** : la table est écrite mais **toujours illisible** — aucune route ne l'expose ; c'est le prochain maillon.
**Lecture unifiée des notifications (backend, PR B)** (**la table cesse d'être invisible**) : **`GET /notifications` + `PATCH /notifications/:id/read`**, premier contrôleur du module. PR A avait ouvert `recipient_user_id`, `read_at_utc` et `NEW_DIRECT_BOOKING` ; le module restait **écriture seule** (`insertBatch`/`insertOne`, zéro `find`, `controllers` absent du `@Module`) — ce qui s'y écrivait n'était lisible qu'en SQL. **ZÉRO migration** (les colonnes existent), **zéro front**, **zéro canal externe**, **zéro marquage en masse**, **zéro nouveau membre d'enum**, **zéro curseur**.
**L'union est UNE requête, mesurée et pas affirmée** : les deux branches destinataires sont **un seul `OR`** — jamais deux requêtes additionnées en mémoire (elles ne pourraient être ni triées ni plafonnées de façon cohérente). **Compté au journal Postgres** (`log_statement='all'`, en comptant les `execute <unnamed>` — les requêtes paramétrées ne s'y journalisent **pas** comme `statement:`, d'où un premier comptage à 0 qui n'était qu'un artefact de mesure) : **1 énoncé SQL pour un `GET /notifications`**, **1 pour un `PATCH …/read`**.
**Le jeu de profils est résolu EN SQL, en mirroitant `findByUserId` VERBATIM** (`service-provider.repository.ts:136` — INDIVIDUAL, `deleted_at_utc IS NULL`, **prestataire en pause inclus**) : sous-requête `IN (SELECT …)` plutôt que `=` pour que la sémantique d'ensemble généralise le jour où un user portera plusieurs profils ; aujourd'hui au plus une ligne matche. **Un seul prédicat, `RECIPIENT_PREDICATE`, partagé par la lecture ET l'écriture** (`$1` = l'appelant dans les DEUX requêtes — `markRead` passe ses paramètres dans cet ordre **exprès**) : les deux surfaces **ne peuvent pas diverger**. **Vérifié au runtime dans les deux sens** : profil **en pause** → lit toujours ses notifications ; profil **soft-deleted** → sort du jeu (0 item), restauré → 50.
> ⚠️ **LES PROVIDERS `ORGANIZATION` SONT HORS DU JEU — DÉCISION, PAS OUBLI.** **Aucune** voie backend ne résout user → les providers ORGANIZATION qu'il possède : l'appartenance ne se parcourt que dans l'**autre** sens (`assertCanManageProvider` → `assertActiveOwner` → `findActiveByOrgAndUser`), c'est-à-dire une **vérification** partant d'un provider, jamais un **listing** partant d'un user. Or `findEligibleProviderIds` **ne filtre pas `provider_type`** → un provider ORGANIZATION **peut déjà détenir** des `NEW_TENDER_MATCH`. Inventer ici la résolution manquante serait poser un **second avis, plus faible, sur le RBAC organisationnel** dans un module qui n'en est pas juge. Donc : un OWNER **ne lit pas** les notifications du provider de son organisation. **Dette ouverte** (cf. §6) — le correctif est une méthode de listing dans le domaine `service-providers`, pas un `OR` de plus ici.
> ⚠️ **LE `LEFT JOIN` EST UNE DÉCISION — un `INNER` ferait disparaître des lignes en silence.** `service_requests` est joint **sans filtrer `deleted_at_utc`**, et l'état est **projeté** : `serviceRequestStatus` = le statut **ACTUEL** (pas celui du moment de la notification) + `serviceRequestDeleted` (booléen). Une demande **annulée** affiche `CANCELLED`, une demande **soft-deleted** reste listée avec son drapeau. **Prouvé au runtime** : après `PATCH …/cancel` puis un soft-delete manuel, les 2 notifications sont **toujours là** (`CANCELLED` / `deleted=true`). Une notification **orpheline** (`service_request_id NULL`, cas réel du schéma) rend sans crash, tous les champs joints à `null`. Masquer aurait laissé le destinataire avec **rien** ; une pastille qui ne mène nulle part est pire que la vérité.
> ⚠️ **`unreadCount` EST CALCULÉ SUR L'ENSEMBLE, PAS SUR LA PAGE**, via `COUNT(*) FILTER (WHERE read_at_utc IS NULL) OVER ()` : les fonctions de fenêtrage s'évaluent **AVANT** le `LIMIT`, donc le compteur ne ment pas quand le plafond tronque. **Mesuré** : 63 lignes en base → `items = 50`, `total = 63`, **`unreadCount = 62`**. Zéro ligne → aucune ligne d'où les lire → `0`/`0`, qui est la bonne réponse. **Plafond dur 50, en constante serveur, aucun paramètre de requête, aucun curseur** — la pagination réelle est une dette assumée ailleurs (dashboard, `/requests`, `/recherche`) et **on ne l'ouvre pas ici** ; `total` est ce qui dit au lecteur que le plafond a mordu.
**Tri `created_at_utc DESC, id DESC` — le départage est PORTANT, pas décoratif** : `broadcastTenderMatch()` insère tout son fan-out **dans une transaction**, donc ces lignes partagent un `now()` **à la microseconde**. Sans second critère l'ordre serait instable d'un appel à l'autre. **Vérifié** : deux `GET` successifs sur 63 lignes quasi-simultanées renvoient **la même tête de liste**.
**`PATCH /notifications/:id/read` — idempotent en UN énoncé** : `read_at_utc = COALESCE(read_at_utc, now())`, et `updated_at_utc` **bougé seulement si la lecture a réellement eu lieu** (`CASE WHEN read_at_utc IS NULL …` — dans un `UPDATE`, le côté droit lit les **anciennes** valeurs) → un second appel **réécrit exactement ce qu'il a trouvé**. C'est ce qui rend « zéro ligne » **non ambigu** : cela ne peut signifier qu'inexistante / soft-deleted / pas à l'appelant — **jamais « déjà lue »**. **Mesuré** : 2ᵉ appel → **même `readAtUtc`**, `updated_at_utc` **inchangé**. `updated_at_utc` est posé à la main parce que le SQL brut court-circuite `@UpdateDateColumn` (le défaut de colonne ne joue qu'à l'`INSERT`).
> ⚠️ **404, JAMAIS 403, sur une notification qui n'est pas à l'appelant.** Un 403 **confirmerait** qu'un id donné est une vraie notification appartenant à quelqu'un d'autre ; il n'y a rien à y gagner. Même réponse qu'une notification inexistante. **Prouvé dans les deux sens** : prestataire → notification du client = **404**, client → notification du prestataire = **404**, uuid inconnu = **404**, non-uuid = **400** (`ParseUUIDPipe`), sans jeton = **401** (guard global) — **et la ligne visée n'a PAS été marquée lue** par la tentative.
**Contrat : `@ApiProperty` EXPLICITE SUR CHAQUE CHAMP, `nullable` compris — et ce n'est pas de la décoration.** Le plugin Swagger n'étant pas activé dans `nest-cli.json`, un champ non annoté sort **vide** dans `openapi.json` ; et un champ annoté **sans `type` concret** reflète `design:type = Object` pour une union `T | null` → atterrit en **`Record<string, never>`** (la dette *nullable* §6). `data` (JSONB libre) porte **`additionalProperties: true`**, les maps i18n **`additionalProperties: { type: 'string' }`**. **Résultat vérifié dans le généré, pas espéré** : `readAtUtc: string | null`, `serviceRequestTitle: string | null`, `serviceRequestStatus: …ServiceRequestStatus | null`, `data: { [key: string]: unknown } | null`, `serviceCategoryNameTranslations: { [key: string]: string } | null` — **ZÉRO `Record<string, never>` dans le bloc ajouté**, donc **aucun miroir ni cast à écrire côté front en PR C**. Enveloppe **honnête dès le départ** (`NotificationListDto`, dédiée et spécifique — pas de générique `PaginatedResponseDto<T>` spéculatif ; patron 3.12a-back-fix / 3.13-A), **sans `page`** puisqu'il n'y a pas de pagination.
> ⚠️ **UN POINT DU PLAN EST IRRÉALISABLE ET N'A PAS ÉTÉ SIMULÉ : « ville ».** `grep -rn "city\|locality" apps/api/src` ne renvoie **rien** — `service_requests` ne porte qu'un `service_address` **texte libre**. Le parser serait de la fabrication. Et servir l'adresse **complète** serait une exposition **NOUVELLE**, pas un statu quo : `GET /service-requests/:id` est **propriétaire-ou-ADMIN**, et le dashboard prestataire n'affiche une adresse que pour les demandes **assignées ou ciblées** sur lui. Un destinataire de `NEW_TENDER_MATCH` n'est **ni l'un ni l'autre** — c'est un match **géographique** : le champ diffuserait l'adresse de chaque client à **tous** les prestataires du rayon. Le DTO porte donc **titre + métier i18n + statut réel, et AUCUNE localisation** ; le destinataire sait déjà que c'est dans sa zone, **c'est la condition qui lui a valu la notification**. Le correctif honnête est une colonne `locality` **capturée au géocodage** — dette §6.
**Validé** : `pnpm --filter @linkr/api build` **vert**, **jest 22/22 vert**, `@linkr/api-client` + `@linkr/web` **typecheck verts**. **Contrat régénéré EN BOOTANT L'APP** (jamais à la main ; Postgres 16 + **PostGIS 3.4 installé** + Redis montés localement, migrations + seed Québec passés) : `openapi.json` **+225/−0**, `schema.d.ts` **+152/−0**, **zéro suppression** — donc **aucune route existante modifiée**. Les 3 schémas d'énum hissés (`NotificationType`, `ServiceRequestStatus`, `ServiceRequestType`, via `enumName`) sont des **ajouts** : les DTO existants gardent leurs énums **inlinées** (`CreateServiceRequestDto` vérifié). **Smoke END-TO-END RÉEL** sur `:5000` : inscription client + prestataire → profil → métier Coiffure → **DIRECT_BOOKING + PROJECT_TENDER** → le prestataire lit **2 notifications** (`unreadCount=2`, libellés i18n joints, `data` du broadcast conservé, `data:{}` du direct-booking) ; **le client, sans profil prestataire, lit une enveloppe vide** — et, après insertion manuelle d'une ligne `recipient_user_id` (rien ne l'écrit encore), **la voit, seul** : les deux branches de l'union sont **étanches**.
**Hors périmètre, non abordés** : front (cloche, badge), canal externe (courriel/push — §9 : BullMQ, jamais en synchrone), marquage en masse, pagination par curseur, nouveaux membres d'enum.
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
