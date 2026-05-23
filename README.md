# Linkr

**Linkr — The LinkedIn × Uber for blue-collar professionals and informal service providers. Mobile-first, built for Quebec, designed glocal.**

---

## Status

Pre-implementation — Phase 3 in progress

Step 3.1 (Monorepo Foundation) complete. See [CLAUDE.md](./CLAUDE.md) for the full roadmap.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend Framework | NestJS + TypeScript |
| ORM | TypeORM |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| Cache / Queues | Redis 7 + Bull |
| Web Portal | Next.js (App Router) |
| Mobile | Expo / React Native |
| Payments | Stripe Connect Express |
| Monorepo | Turborepo + pnpm |
| Containerization | Docker + Docker Compose |

---

## Prerequisites

- **Node** ≥ 20
- **pnpm** ≥ 9
- **Docker Desktop** (or Docker Engine + Compose plugin)

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy env file and edit as needed
cp .env.example .env

# Start infrastructure (PostgreSQL 16/PostGIS, Redis 7, pgAdmin)
docker compose --project-directory . -f docker/docker-compose.yml up -d
```

pgAdmin is available at http://localhost:5050 (credentials in `.env`).

---

## Project Structure

```
linkr/
├── apps/
│   ├── api/          # NestJS backend (REST API) — Step 3.2+
│   ├── web/          # Next.js web portal — Step 3.10+
│   └── mobile/       # Expo / React Native — Step 3.11+
│
├── packages/
│   ├── shared-types/   # TypeScript interfaces shared across apps
│   ├── shared-utils/   # Validation, formatting, constants
│   └── shared-config/  # ESLint, Prettier, tsconfig.base.json
│
├── docker/
│   └── docker-compose.yml   # postgres + redis + pgadmin
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .env.example
└── CLAUDE.md
```

---

## Documentation

**[CLAUDE.md](./CLAUDE.md)** is the authoritative architectural brief and source of truth for all technical decisions, including:

- Full database schema (Section 5)
- Technology stack rationale (Section 3)
- Implementation roadmap (Section 11)
- Coding standards and mandatory patterns (Section 10)
- Quebec compliance requirements (Section 7)

---

## License

TBD
