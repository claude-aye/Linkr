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
| **Cache / Queues** | Redis 7 + Bull | Async tasks: webhooks Stripe, cron jobs (expired licenses), notifications |
| **Mobile** | React Native + Expo | Full TypeScript stack, OTA updates, EAS Build |
| **Web Portal** | Next.js | SSR for SEO of public org pages, App Router |
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
| `status` | enum (`SUBMITTED`, `WITHDRAWN`, `ACCEPTED`, `REJECTED`) | |
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

The following operations MUST be queued (never executed synchronously in HTTP handlers):

1. **Stripe webhooks** — Verify signature → enqueue → respond 200 OK to Stripe within 5 seconds. Process asynchronously.
2. **Email sending** — Transactional emails (booking confirmations, receipts, etc.)
3. **Push notifications** — To mobile clients
4. **License expiration check (Cron job, nightly)** — Scans `verification_documents` for `expires_at_utc < NOW()`. Marks expired docs as `EXPIRED`, downgrades parent `professional_service_category.verification_status` to `REJECTED`, notifies the provider.
5. **Quote deadline expiration (Cron job, hourly)** — Scans `service_requests.quotes_deadline_utc < NOW()` with status `OPEN` and transitions them to `EXPIRED` if no quote was accepted.
6. **Direct booking response deadline (Cron job, every 5 min)** — Scans `service_requests.response_deadline_utc < NOW()` with status `OPEN` and `request_type = DIRECT_BOOKING`, transitions to `EXPIRED`.
7. **Stripe Connect onboarding reminders** — For providers in `INFO_NEEDED` status > 48 hours.

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

| Step | Task | Deliverable |
|---|---|---|
| 3.1 | Monorepo Foundation | `docker compose up` starts postgres+redis+pgadmin; `pnpm install` works at root |
| 3.2 | API Bootstrap | NestJS starts on port 3000; `GET /health` returns 200 with DB+Redis connection verified |
| 3.3 | Initial Migrations + Entities | TypeORM migrations create User domain tables (users, user_auth_providers); PostGIS extension enabled |
| 3.4 | Auth Module | Email/Password signup + login working; JWT issuance; Google + Apple OAuth flows |
| 3.5 | Users + Organizations Modules | CRUD endpoints; org membership management; role-based guards |
| 3.6 | Services Catalog Module | Admin CRUD for categories/items/requirements; Quebec seed data (RBQ, CMEQ, CMMTQ, CCQ) |
| 3.7 | Service Providers Module | Polymorphic provider creation; geo zones; verification documents upload (S3/R2) |
| 3.8 | Requests + Quotes Module | Unified state machine; geo matching for tender notifications |
| 3.9 | Stripe Connect + Payments | Express onboarding flow; deposit/balance flow; webhook handlers; refunds |
| 3.10 | Frontend Bootstrap (Web) | Next.js consuming the API; auth pages; first protected route |
| 3.11 | Frontend Bootstrap (Mobile) | Expo app with auth flow; provider search screen using geolocation |
| 3.12+ | Feature Iteration | According to business priority |

---

## 12. Environment Variables (Mandatory at Boot)

Each app MUST validate these via Joi/Zod schema at startup. Missing or malformed = crash immediately.

### API (`apps/api/.env`)

```
NODE_ENV=development|production
PORT=3000

DATABASE_URL=postgresql://user:password@host:5432/linkr
REDIS_URL=redis://host:6379

JWT_SECRET=...
JWT_EXPIRES_IN=7d

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

STORAGE_BUCKET=linkr-uploads
STORAGE_REGION=ca-central-1
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...

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
NEXT_PUBLIC_API_URL=http://localhost:3000
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
