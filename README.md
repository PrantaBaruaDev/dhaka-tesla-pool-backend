# Dhaka Tesla Pool — Backend API

The backend for **Dhaka Tesla Pool**, a ride-pooling prototype for Dhaka. Passengers request rides between predefined zones; a driver's Tesla (Bullet, 3-seat capacity) carries one or more passengers going the same direction; each passenger gets their own independently-computed fare.

This document covers everything about the backend: architecture, database design, business logic, API reference, testing, and deployment.

> **"MVP" throughout this project means Minimum Viable Product** — the smallest end-to-end slice that satisfies the brief. It does **not** mean Model-View-Presenter.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Quick Start](#2-quick-start)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Architecture](#5-architecture)
6. [Database Design](#6-database-design)
7. [Domain Model & Business Rules](#7-domain-model--business-rules)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Fare Model — Deep Dive](#9-fare-model--deep-dive)
10. [Pooling & Concurrency](#10-pooling--concurrency)
11. [State Machine](#11-state-machine)
12. [API Reference](#12-api-reference)
13. [Error Handling](#13-error-handling)
14. [Logging](#14-logging)
15. [Testing](#15-testing)
16. [Environment Variables](#16-environment-variables)
17. [Deployment](#17-deployment)
18. [Known Limitations](#18-known-limitations)
19. [Next Improvements](#19-next-improvements)

---

## 1. Overview

### What This Service Does

The backend is a stateless REST API that owns:
- User authentication (JWT in httpOnly cookie or Bearer header)
- Zone reference data
- Ride request lifecycle
- Pool matching and capacity enforcement
- Fare calculation (distance, per-seat pricing, pool discount)
- Full audit trail of every state transition

### The Cast

Seed data uses a consistent cast across tests, documentation, and the demo video:

| Role | Name | Description |
|------|------|-------------|
| Driver | **Jashim** | Owns *Bullet*, a 3-seat Tesla |
| Passenger | **Nusrat** | Banani → Mohakhali, 1 seat |
| Passenger | **Rafiq** | Banani → Gulshan 1, 1 seat |
| Passenger | **Shirin** | Tries for the last seat (concurrency scenario) |

### Scope

**In scope:**
- Auth, ride requests, pool lifecycle, fare computation, audit trail
- Concurrency-safe capacity enforcement
- Zod `.strict()` validation on all inputs

**Out of scope:**
- Real map routing / turn-by-turn directions
- Push notifications, ratings, in-app chat
- Multiple vehicles per driver
- Payments ledger

---

## 2. Quick Start

```bash
# 1. Clone and enter
git clone <repo-url>
cd dhaka-tesla-pool/backend

# 2. Install dependencies
bun install

# 3. Configure environment
cp ../.env.example .env
# Edit .env — set DATABASE_URL, DIRECT_URL, JWT_SECRET

# 4. Apply migrations and seed
bunx prisma migrate dev --name init
bun run prisma/seed.ts

# 5. Start development server
bun run dev
# API on http://localhost:5000

# 6. (optional) Run tests
bun test
```

### Verify

```bash
curl http://localhost:5000/health
# → {"status":"ok","ts":"..."}
```

### Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Driver | `jashim@tesla.dhaka` | `password123` |
| Passenger | `nusrat@example.com` | `password123` |
| Passenger | `rafiq@example.com` | `password123` |
| Passenger | `shirin@example.com` | `password123` |

---

## 3. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | **Bun** | Fast startup, native TS, built-in `.env` loading, no build step in dev |
| Web framework | **Express** | Minimal ceremony; the domain is small |
| Database | **PostgreSQL (Neon)** | Real constraints, transactions, ACID guarantees |
| ORM | **Prisma** | Type-safe schema, migrations, seed scripting |
| Auth | **JWT (httpOnly cookie)** + **bcryptjs** | Stateless; cookie prevents XSS token theft; bcryptjs is portable across runtimes |
| Validation | **Zod** (`.strict()`) | Type-safe parsing; rejects unknown keys |
| Tests | **`bun test`** + **Supertest** | Fast integration tests against the real app |
| Bundler (production) | **tsup** | Plain JS output that runs on Node 20 |

---

## 4. Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma              # Data model
│   ├── migrations/                # Versioned migrations
│   └── seed.ts                    # Seed data (cast, zones)
├── src/
│   ├── app/
│   │   ├── config/
│   │   │   └── index.ts           # Env var loader
│   │   ├── lib/
│   │   │   ├── prisma.ts          # PrismaClient singleton
│   │   │   └── logger.ts          # Structured logger
│   │   ├── utils/
│   │   │   ├── catchAsync.ts      # Async error wrapper
│   │   │   └── jwt.ts             # JWT sign/verify
│   │   └── modules/
│   │       ├── auth/              # Signup, login, me, logout
│   │       ├── zones/             # Reference data
│   │       ├── rides/             # Passenger-facing ride requests
│   │       ├── fares/             # Fare computation (pure functions)
│   │       └── driver/            # Pool lifecycle, matching, acceptance
│   ├── middleware/
│   │   ├── auth.ts                # auth(...roles) middleware
│   │   ├── error.handler.ts       # Centralized error → JSON
│   │   └── request-logger.ts      # Per-request logging
│   ├── app.ts                     # Express app factory
│   └── server.ts                  # Entry point
├── tests/
│   ├── helpers/
│   ├── auth.test.ts
│   ├── zones.test.ts
│   ├── rides.test.ts
│   ├── fare.test.ts
│   ├── driver.test.ts
│   ├── pooling.test.ts
│   └── history.test.ts
├── bunfig.toml                    # Bun test config
├── tsup.config.ts                 # Production bundler config
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## 5. Architecture

```mermaid
flowchart LR
    subgraph Client
        B[Browser]
    end
    subgraph Frontend
        N["Next.js App Router"]
    end
    subgraph Backend
        A["Express API\n(auth, rides, pools, fare)"]
    end
    subgraph Data
        DB[(PostgreSQL)]
    end

    B -->|HTTPS| N
    N -->|REST + JWT cookie| A
    A -->|Prisma ORM| DB
```

### Request Lifecycle

1. **Middleware chain** (in order)
   - CORS — allows the frontend origin
   - `express.json()` — parses JSON body
   - `cookie-parser` — parses cookies
   - `requestLogger` — assigns a request ID, logs entry/exit
   - `auth(...roles)` — verifies JWT, loads user, enforces role
2. **Controller** — parses body with Zod, calls service
3. **Service** — business logic, DB transactions
4. **Prisma** — data access
5. **Response** — controller sends JSON
6. **Error handler** — catches thrown errors, formats JSON

### Single Source of Truth

**All business rules live in the backend.** The client cannot compute distance or fare — it sends only zone IDs and a seat count. Every fare, every capacity check, and every state transition is validated server-side.

---

## 6. Database Design

### ERD

```mermaid
erDiagram
    USERS ||--o{ RIDE_REQUESTS : "makes"
    USERS ||--o| TESLAS : "owns"
    TESLAS ||--o{ POOLS : "runs"
    POOLS ||--o{ RIDE_REQUESTS : "contains"
    RIDE_REQUESTS ||--o{ RIDE_STATUS_HISTORY : "logs"
    ZONES ||--o{ RIDE_REQUESTS : "pickup"
    ZONES ||--o{ RIDE_REQUESTS : "destination"
```

### Tables

#### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | string | |
| `email` | string UNIQUE | |
| `password_hash` | string | bcrypt (10 rounds) |
| `role` | enum | `PASSENGER` \| `DRIVER` |
| `created_at` | timestamp | |

#### `zones`

Reference data. Seeded once, never written through the API.

| Column | Type | Notes |
|--------|------|-------|
| `id` | string PK | e.g. `z-banani` |
| `name` | string UNIQUE | e.g. `Banani` |
| `lat` | float | |
| `lng` | float | |
| `cluster` | string | Corridor group used for matching |

**Seeded zones:**

| Zone | lat | lng | cluster |
|------|-----|-----|---------|
| Banani | 23.7936 | 90.4043 | banani-corridor |
| Mohakhali | 23.7666 | 90.4074 | banani-corridor |
| Gulshan 1 | 23.7736 | 90.4161 | banani-corridor |
| Dhanmondi | 23.7461 | 90.3742 | dhanmondi-mirpur |
| Mirpur | 23.8223 | 90.3654 | dhanmondi-mirpur |
| Uttara | 23.8759 | 90.3795 | uttara-airport |
| Farmgate | 23.7580 | 90.3900 | central |
| Bashundhara | 23.8223 | 90.4265 | east |

#### `teslas`

One per driver (unique constraint on `driver_id`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `driver_id` | uuid FK UNIQUE | → `users.id` |
| `label` | string | e.g. `Bullet` |
| `capacity` | int | Seeded as 3 |
| `is_online` | bool | Driver-controlled |
| `updated_at` | timestamp | |

#### `pools`

One Tesla trip. Groups 1+ ride requests.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tesla_id` | uuid FK | |
| `status` | enum | `OPEN` \| `IN_PROGRESS` \| `COMPLETED` \| `CANCELLED` |
| `seats_occupied` | int | Sum of matched rides' seats |
| `started_at` | timestamp? | |
| `completed_at` | timestamp? | |
| `version` | int | Optimistic lock (default 0) |

**Partial unique index** (prevents two OPEN pools per Tesla):
```sql
CREATE UNIQUE INDEX "pools_tesla_open_unique"
  ON "pools" ("tesla_id")
  WHERE "status" = 'OPEN';
```

#### `ride_requests`

Passenger-facing unit. One row per booking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `passenger_id` | uuid FK | |
| `pool_id` | uuid FK? | NULL until matched |
| `pickup_zone_id` | string FK | |
| `destination_zone_id` | string FK | |
| `seats_requested` | int | 1–3 |
| `status` | enum | See [State Machine](#11-state-machine) |
| `straight_line_meters` | int | Haversine snapshot |
| `road_distance_meters` | int | Straight × 1.4, rounded to 0.1 km |
| `estimated_fare_poysha` | int | Solo, no discount |
| `final_fare_poysha` | int? | Set at completion |
| `payment_method` | enum | `CASH` \| `TESLAPAY` |
| `requested_at` | timestamp | |
| `matched_at` | timestamp? | |
| `completed_at` | timestamp? | |
| `cancelled_at` | timestamp? | |

#### `ride_status_history`

Every transition is logged here.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `ride_request_id` | uuid FK | |
| `from_status` | string? | NULL for first entry |
| `to_status` | string | |
| `changed_by` | uuid FK | → `users.id` |
| `changed_at` | timestamp | |

### Design Decisions

- **Money as integer poysha** — no floats, no rounding drift.
- **Two distance columns** — `straight_line_meters` and `road_distance_meters`. The straight-line value is the raw haversine; the road distance is what fares use. Both are stored so historical fares stay reproducible if coordinates change.
- **`version` column on pools** — used for optimistic locking during concurrent accepts.
- **`zones` has no write API** — seeded once, versioned in git. Eliminates coordinate tampering.
- **`ride_status_history`** — full audit; nothing inferred from timestamps.

---

## 7. Domain Model & Business Rules

### Two Units, Two Tables

- **`ride_requests`** — passenger-facing. Each passenger has their own row, their own fare, their own status.
- **`pools`** — Tesla-trip-facing. Groups 1+ ride requests on one physical trip.

This separation is what makes "pooling" a first-class relationship.

### Matching Rule

A new `REQUESTED` ride is eligible to join an existing `OPEN` pool if:

1. Its pickup zone's `cluster` matches the pool's existing rides' pickup cluster, **and**
2. Its destination zone's `cluster` matches the pool's existing rides' destination cluster, **and**
3. `pool.seats_occupied + new_ride.seats_requested <= tesla.capacity`, **and**
4. Pool is still `OPEN`.

### Per-Seat Pricing

Fares are per-seat. A passenger booking 3 seats pays 3× the per-seat fare. This closes the loophole where one person could occupy Bullet's entire capacity at a solo price.

### Pool Discount

Applied **only** when the pool contains 2+ **distinct passengers** at completion. Booking extra seats for yourself does not trigger the discount.

Discount = 20% of the passenger's subtotal.

---

## 8. Authentication & Authorization

### Token Shape

```json
{
  "userId": "u-nusrat-001",
  "email": "nusrat@example.com",
  "name": "Nusrat",
  "role": "PASSENGER",
  "iat": 1728000000,
  "exp": 1728086400
}
```

Signed with HS256 using `JWT_SECRET`.

### Delivery

Two ways:

1. **httpOnly cookie** (`access_token`) — set by `/auth/login` and `/auth/signup`, sent automatically by browsers.
2. **`Authorization: Bearer <token>` header** — for API clients, mobile apps, and tests.

The auth middleware checks the cookie first, then the header.

### The `auth(...roles)` Middleware

```ts
auth()                          // any logged-in user
auth('PASSENGER')               // passenger only
auth('DRIVER')                  // driver only
auth('DRIVER', 'PASSENGER')     // either
```

Each call returns an Express middleware that:
1. Extracts the token (cookie → header fallback)
2. Verifies the JWT
3. Checks that the user's role is in the allowed set
4. Loads the user from the DB (ensures account still exists)
5. Attaches `req.user = { userId, email, name, role }`

### Cookie Options

```ts
{
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 24 * 60 * 60 * 1000,
}
```

**Note on cross-origin:** when the frontend and backend are on different domains, use Next.js rewrites to proxy `/api/*` to the backend. This keeps cookies first-party. Do not set `sameSite: 'none'` — it's fragile with browser third-party cookie phase-outs.

---

## 9. Fare Model — Deep Dive

### The Formula

```
straightLineMeters = haversine(pickup, destination)
roadDistanceMeters = round(straightLineMeters × 1.4 / 100) × 100
distanceKm         = roadDistanceMeters / 1000

perSeatFare    = BASE_FARE_POYSHA + (distanceKm × PER_KM_POYSHA)
subtotal       = perSeatFare × seats
poolDiscount   = (uniquePassengers > 1) ? round(subtotal × 0.20) : 0
finalFare      = subtotal − poolDiscount
```

### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `BASE_FARE_POYSHA` | `3000` | ৳30 flat |
| `PER_KM_POYSHA` | `1500` | ৳15 per km |
| `CIRCUITY_FACTOR` | `1.4` | Dhaka road/straight-line ratio |
| `POOL_DISCOUNT` | `0.20` | 20% off |
| `DISTANCE_ROUNDING_M` | `100` | Round to nearest 100 m |
| `MAX_DHAKA_DISTANCE_M` | `50_000` | Sanity bound |

### Why Circuity × 1.4

Straight-line underestimates real road distance. Roads zig-zag. In Dhaka — rivers, one-ways, flyovers — the detour index is typically 1.3–1.5. We use 1.4.

**Validation:** for the coordinate pair (22.3593, 91.8219) → (22.3582, 91.8374), Google Maps reports two real routes at 1.8 km and 2.3 km. Our formula gives 2.2 km — inside the real-route envelope.

### Worked Examples

**Banani → Mohakhali (seeded coordinates):**

| Metric | Value |
|--------|-------|
| Straight-line | 3019 m |
| Road (× 1.4, rounded) | 4200 m = 4.2 km |
| Per-seat fare | 3000 + 4.2 × 1500 = **9300 poysha** (৳93.00) |

**Rafiq's Banani → Gulshan 1:**

| Metric | Value |
|--------|-------|
| Straight-line | 2530 m |
| Road | 3500 m = 3.5 km |
| Per-seat fare | 3000 + 3.5 × 1500 = **8250 poysha** (৳82.50) |

### Discount Scenarios

**Nusrat solo (1 seat):** 9300 poysha = ৳93.00

**Nusrat + Rafiq pooled:**
- Nusrat: 9300 → 20% off → **7440** (৳74.40)
- Rafiq: 8250 → 20% off → **6600** (৳66.00)
- Total collected: 14040 poysha = ৳140.40

**Nusrat alone, 3 seats:**
- Subtotal: 9300 × 3 = 27900
- No discount (only 1 passenger)
- **27900 poysha = ৳279.00**

**Nusrat 2 seats + Rafiq 1 seat:**
- Nusrat: 18600 → 20% off → **14880** (৳148.80)
- Rafiq: 8250 → 20% off → **6600** (৳66.00)
- Total: 21480 poysha = ৳214.80

### Why Store Both Distances

| Column | Purpose |
|--------|---------|
| `straight_line_meters` | Audit; future migration to real routing |
| `road_distance_meters` | The value fares are computed from |

If zone coordinates ever change, historical fares remain reproducible because the value used is snapshotted.

### Fraud Prevention

The client **never** sends distance or fare. `POST /api/v1/rides` uses Zod `.strict()`:

```ts
export const createRideSchema = z.object({
  pickupZoneId: z.string().min(1),
  destinationZoneId: z.string().min(1),
  seats: z.number().int().min(1).max(3),
  paymentMethod: z.enum(['CASH', 'TESLAPAY']),
}).strict();
```

Any request with a `distanceMeters`, `estimatedFarePoysha`, or `poolId` field gets `400 VALIDATION_ERROR`.

---

## 10. Pooling & Concurrency

### The Last-Seat Problem

Bullet has 1 seat left. Nusrat and Shirin both try to accept at nearly the same instant.

### The Solution — Optimistic Locking

We use a **version column** on the pool and **conditional updates** instead of `SELECT ... FOR UPDATE`.

**The `acceptRequest` transaction:**

```ts
// 1. Claim the ride atomically — only ONE transaction can do this
const claimed = await tx.rideRequest.updateMany({
  where: { id: rideRequestId, status: 'REQUESTED' },
  data: { status: 'MATCHED', matchedAt: new Date() },
});
if (claimed.count === 0) throw new ApiError(409, 'INVALID_TRANSITION', ...);

// 2. Increment the pool, guarded by version
const poolUpdate = await tx.pool.updateMany({
  where: { id: activePool.id, version: activePool.version, status: 'OPEN' },
  data: { seatsOccupied: { increment: ride.seatsRequested }, version: { increment: 1 } },
});
if (poolUpdate.count === 0) throw new ApiError(409, 'RETRY_NEEDED', ...);
```

**What happens:**

- Both transactions read `version = 2` initially.
- Postgres serializes the two `UPDATE` statements.
- First transaction: version becomes 3, ride claimed, capacity reserved.
- Second transaction: its `WHERE version = 2` matches 0 rows → `RETRY_NEEDED` → retry → now sees version 3 → capacity full → `POOL_FULL`.

**Outcome:** exactly one 200, one 409. Test asserts this.

### Retry Loop

`acceptRequest` wraps the transaction in a retry loop (max 3 attempts). Only `RETRY_NEEDED` triggers a retry.

### Why Not `SELECT ... FOR UPDATE`

Pessimistic locking blocks. Optimistic fails fast and retries. For this domain, optimistic is cleaner:

- No raw SQL
- Uses the `version` column meaningfully
- Easier to reason about and test
- Same outcome — one succeeds, one fails

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Two parallel accepts on last seat | One succeeds, one `POOL_FULL` |
| Two parallel pool creations for same Tesla | Partial unique index prevents — one retries and joins |
| Passenger cancels after arrival | Seat freed; remaining passengers can still start |
| Pool becomes empty after cancel | Pool status → `CANCELLED` |
| Admin edits zone coordinates mid-flight | Historical fares unaffected (snapshots) |

---

## 11. State Machine

```
REQUESTED --(driver accepts)--> MATCHED --(driver arrives)--> DRIVER_ARRIVED --(driver starts)--> STARTED --(driver completes)--> COMPLETED
    |                              |
    | (passenger cancels)          | (passenger or driver cancels, before pickup)
    v                              v
CANCELLED                      CANCELLED
```

| From | To | Who | Rule |
|------|----|-----|------|
| `REQUESTED` | `MATCHED` | Driver | Tesla has capacity; request not already matched |
| `MATCHED` | `DRIVER_ARRIVED` | Driver | Must own the pool |
| `DRIVER_ARRIVED` | `STARTED` | Driver | All (non-cancelled) passengers must be `DRIVER_ARRIVED` |
| `STARTED` | `COMPLETED` | Driver | Final fare written from snapshot |
| `REQUESTED`/`MATCHED` | `CANCELLED` | Passenger | Own request only; not allowed after `DRIVER_ARRIVED` |

Every transition is validated **server-side against the current DB status**, never the client's assumed status. Every transition writes a `ride_status_history` row.

### Pool Status Transitions

| From | To | Trigger |
|------|----|---------|
| `OPEN` | `IN_PROGRESS` | Driver calls `/start` |
| `IN_PROGRESS` | `COMPLETED` | Driver calls `/complete` |
| `OPEN` | `CANCELLED` | All passengers cancel (seats_occupied = 0) |

---

## 12. API Reference

Base URL: `/api/v1`

### Authentication

---

#### `POST /auth/signup`

Create a new user. If `role = DRIVER`, a default Tesla is auto-created.

**Request:**
```json
{
  "name": "Nusrat",
  "email": "nusrat@example.com",
  "password": "password123",
  "role": "PASSENGER"
}
```

**Response `201`:**
```json
{
  "user": {
    "id": "u-nusrat-001",
    "name": "Nusrat",
    "email": "nusrat@example.com",
    "role": "PASSENGER",
    "createdAt": "2026-09-23T08:05:00.000Z"
  },
  "token": "eyJhbGci..."
}
```

**Also sets:** `Set-Cookie: access_token=...; HttpOnly; SameSite=Lax; Path=/`

---

#### `POST /auth/login`

**Request:**
```json
{ "email": "nusrat@example.com", "password": "password123" }
```

**Response `200`:**
```json
{
  "user": { "id": "u-nusrat-001", "name": "Nusrat", "email": "nusrat@example.com", "role": "PASSENGER" },
  "token": "eyJhbGci..."
}
```

**Also sets:** auth cookie.

---

#### `POST /auth/logout`

Clears the `access_token` cookie.

**Response `204`:** no body.

---

#### `GET /auth/me`

Requires: any authenticated user (`auth()`).

**Response `200`:**
```json
{
  "user": { "id": "u-nusrat-001", "name": "Nusrat", "email": "nusrat@example.com", "role": "PASSENGER" }
}
```

---

### Zones

---

#### `GET /zones`

Public. Returns all seeded zones.

**Response `200`:**
```json
{
  "zones": [
    { "id": "z-banani", "name": "Banani", "lat": 23.7936, "lng": 90.4043, "cluster": "banani-corridor" },
    { "id": "z-mohakhali", "name": "Mohakhali", "lat": 23.7666, "lng": 90.4074, "cluster": "banani-corridor" },
    ...
  ]
}
```

---

### Rides (Passenger)

All endpoints require `auth('PASSENGER')`.

---

#### `POST /rides/preview`

Compute a fare without creating a ride.

**Request:**
```json
{
  "pickupZoneId": "z-banani",
  "destinationZoneId": "z-mohakhali",
  "seats": 2
}
```

**Response `200`:**
```json
{
  "preview": {
    "pickupZone": { "id": "z-banani", "name": "Banani" },
    "destinationZone": { "id": "z-mohakhali", "name": "Mohakhali" },
    "seats": 2,
    "straightLineMeters": 3019,
    "roadDistanceMeters": 4200,
    "perSeatFarePoysha": 9300,
    "subtotalPoysha": 18600,
    "estimatedFarePoysha": 18600
  }
}
```

**Errors:** `400 SAME_ZONE`, `404 ZONE_NOT_FOUND`.

---

#### `POST /rides`

Create a ride request.

**Request:**
```json
{
  "pickupZoneId": "z-banani",
  "destinationZoneId": "z-mohakhali",
  "seats": 1,
  "paymentMethod": "CASH"
}
```

**Zod `.strict()` rejects:** `distanceMeters`, `estimatedFarePoysha`, `poolId`, `status`, or any other unknown key → `400 VALIDATION_ERROR`.

**Response `201`:**
```json
{
  "rideRequest": {
    "id": "rr-nusrat-001",
    "passengerId": "u-nusrat-001",
    "poolId": null,
    "pickupZoneId": "z-banani",
    "destinationZoneId": "z-mohakhali",
    "seatsRequested": 1,
    "status": "REQUESTED",
    "straightLineMeters": 3019,
    "roadDistanceMeters": 4200,
    "estimatedFarePoysha": 9300,
    "finalFarePoysha": null,
    "paymentMethod": "CASH",
    "requestedAt": "2026-09-23T08:41:12.000Z",
    "pickupZone": { "id": "z-banani", "name": "Banani", "cluster": "banani-corridor" },
    "destinationZone": { "id": "z-mohakhali", "name": "Mohakhali", "cluster": "banani-corridor" },
    "perSeatFarePoysha": 9300,
    "subtotalFarePoysha": 9300
  }
}
```

---

#### `GET /rides/me`

**Response `200`:**
```json
{
  "rides": [
    {
      "id": "rr-nusrat-001",
      "pickupZone": { "id": "z-banani", "name": "Banani" },
      "destinationZone": { "id": "z-mohakhali", "name": "Mohakhali" },
      "seatsRequested": 1,
      "status": "COMPLETED",
      "roadDistanceMeters": 4200,
      "estimatedFarePoysha": 9300,
      "finalFarePoysha": 7440,
      "paymentMethod": "CASH",
      "requestedAt": "2026-09-23T08:41:12.000Z",
      "completedAt": "2026-09-23T09:05:00.000Z"
    }
  ]
}
```

---

#### `GET /rides/:id`

Owner-only. Includes pool + driver info if matched.

**Response `200`:**
```json
{
  "rideRequest": {
    "id": "rr-nusrat-001",
    "status": "MATCHED",
    "pickupZone": { "id": "z-banani", "name": "Banani", "cluster": "banani-corridor" },
    "destinationZone": { "id": "z-mohakhali", "name": "Mohakhali", "cluster": "banani-corridor" },
    "pool": {
      "id": "p-001",
      "status": "OPEN",
      "tesla": {
        "id": "t-bullet",
        "label": "Bullet",
        "capacity": 3,
        "driver": { "id": "u-jashim-001", "name": "Jashim" }
      }
    }
  }
}
```

**Errors:** `403 FORBIDDEN`, `404 RIDE_NOT_FOUND`.

---

#### `GET /rides/:id/history`

Full audit timeline.

**Response `200`:**
```json
{
  "history": {
    "rideRequestId": "rr-nusrat-001",
    "currentStatus": "COMPLETED",
    "pickupZone": "Banani",
    "destinationZone": "Mohakhali",
    "seatsRequested": 1,
    "roadDistanceMeters": 4200,
    "estimatedFarePoysha": 9300,
    "finalFarePoysha": 7440,
    "timeline": [
      { "fromStatus": null, "toStatus": "REQUESTED", "changedBy": { "name": "Nusrat", "role": "PASSENGER" }, "changedAt": "..." },
      { "fromStatus": "REQUESTED", "toStatus": "MATCHED", "changedBy": { "name": "Jashim", "role": "DRIVER" }, "changedAt": "..." },
      { "fromStatus": "MATCHED", "toStatus": "DRIVER_ARRIVED", "changedBy": { "name": "Jashim", "role": "DRIVER" }, "changedAt": "..." },
      { "fromStatus": "DRIVER_ARRIVED", "toStatus": "STARTED", "changedBy": { "name": "Jashim", "role": "DRIVER" }, "changedAt": "..." },
      { "fromStatus": "STARTED", "toStatus": "COMPLETED", "changedBy": { "name": "Jashim", "role": "DRIVER" }, "changedAt": "..." }
    ]
  }
}
```

---

#### `POST /rides/:id/cancel`

**Response `200`:**
```json
{
  "rideRequest": {
    "id": "rr-nusrat-001",
    "status": "CANCELLED",
    "cancelledAt": "2026-09-23T08:42:00.000Z"
  }
}
```

**Errors:** `403 FORBIDDEN` (not your ride), `409 INVALID_TRANSITION` (already `STARTED` or later).

**Side effect:** if the ride was in a pool, `seats_occupied` is decremented. If the pool becomes empty, pool status → `CANCELLED`.

---

### Driver

All endpoints require `auth('DRIVER')`.

---

#### `POST /driver/status`

Toggle online/offline.

**Request:**
```json
{ "online": true }
```

**Response `200`:**
```json
{
  "tesla": {
    "id": "t-bullet",
    "label": "Bullet",
    "capacity": 3,
    "isOnline": true,
    "updatedAt": "..."
  }
}
```

---

#### `GET /driver/requests`

Open requests that match the driver's corridor.

**Response `200`:**
```json
{
  "tesla": { "id": "t-bullet", "label": "Bullet", "capacity": 3, "isOnline": true },
  "activePoolId": "p-001",
  "seatsOccupied": 1,
  "requests": [
    {
      "id": "rr-rafiq-001",
      "passenger": { "id": "u-rafiq-001", "name": "Rafiq" },
      "pickupZone": { "id": "z-banani", "name": "Banani", "cluster": "banani-corridor" },
      "destinationZone": { "id": "z-gulshan1", "name": "Gulshan 1", "cluster": "banani-corridor" },
      "seatsRequested": 1,
      "roadDistanceMeters": 3500,
      "estimatedFarePoysha": 8250,
      "status": "REQUESTED",
      "requestedAt": "...",
      "canJoinActivePool": true,
      "activePoolId": "p-001"
    }
  ]
}
```

---

#### `POST /driver/requests/:id/accept`

Create a new pool (if no active pool) or join the existing one.

**Response `200` (new pool):**
```json
{
  "pool": { "id": "p-001", "teslaId": "t-bullet", "status": "OPEN", "seatsOccupied": 1, "version": 0 },
  "rideRequest": { "id": "rr-nusrat-001", "status": "MATCHED", "poolId": "p-001", "matchedAt": "..." },
  "created": true
}
```

**Response `200` (joined existing):**
```json
{
  "pool": { "id": "p-001", "status": "OPEN", "seatsOccupied": 2, "version": 1 },
  "rideRequest": { "id": "rr-rafiq-001", "status": "MATCHED", "poolId": "p-001" },
  "created": false
}
```

**Errors:** `409 POOL_FULL`, `409 CLUSTER_MISMATCH`, `409 INVALID_TRANSITION`, `404 RIDE_NOT_FOUND`.

---

#### `GET /driver/pools/active`

Current pool with **live per-passenger fare projection**.

**Response `200`:**
```json
{
  "pool": {
    "id": "p-001",
    "status": "OPEN",
    "seatsOccupied": 2,
    "capacity": 3,
    "version": 1,
    "isPooled": true,
    "discountPercent": 20,
    "projectedTotalPoysha": 14040,
    "startedAt": null,
    "completedAt": null,
    "passengers": [
      {
        "rideRequestId": "rr-nusrat-001",
        "passengerId": "u-nusrat-001",
        "passengerName": "Nusrat",
        "seats": 1,
        "status": "MATCHED",
        "pickupZone": { "id": "z-banani", "name": "Banani", "cluster": "banani-corridor" },
        "destinationZone": { "id": "z-mohakhali", "name": "Mohakhali", "cluster": "banani-corridor" },
        "estimatedFarePoysha": 9300,
        "perSeatFarePoysha": 9300,
        "subtotalPoysha": 9300,
        "discountPoysha": 1860,
        "projectedFarePoysha": 7440
      }
    ]
  }
}
```

Returns `{ "pool": null }` when no active pool.

---

#### `POST /driver/pools/:id/arrive`

Marks every `MATCHED` ride in the pool as `DRIVER_ARRIVED`.

**Response `200`:**
```json
{
  "pool": { "id": "p-001", "status": "OPEN", "seatsOccupied": 2 },
  "updatedRides": [
    { "id": "rr-nusrat-001", "status": "DRIVER_ARRIVED" },
    { "id": "rr-rafiq-001", "status": "DRIVER_ARRIVED" }
  ]
}
```

---

#### `POST /driver/pools/:id/start`

Transitions to `IN_PROGRESS` and every ride to `STARTED`. Requires all non-cancelled rides to be `DRIVER_ARRIVED`.

**Response `200`:**
```json
{
  "pool": { "id": "p-001", "status": "IN_PROGRESS", "startedAt": "..." },
  "updatedRides": [
    { "id": "rr-nusrat-001", "status": "STARTED" },
    { "id": "rr-rafiq-001", "status": "STARTED" }
  ]
}
```

**Errors:** `409 INVALID_TRANSITION` (passengers not yet arrived).

---

#### `POST /driver/pools/:id/complete`

Transitions to `COMPLETED` and finalizes fares.

**Response `200`:**
```json
{
  "pool": { "id": "p-001", "status": "COMPLETED", "completedAt": "..." },
  "rides": [
    {
      "id": "rr-nusrat-001",
      "passengerId": "u-nusrat-001",
      "roadDistanceMeters": 4200,
      "seats": 1,
      "baseFarePoysha": 9300,
      "subtotalPoysha": 9300,
      "discountPoysha": 1860,
      "finalFarePoysha": 7440
    },
    {
      "id": "rr-rafiq-001",
      "passengerId": "u-rafiq-001",
      "roadDistanceMeters": 3500,
      "seats": 1,
      "baseFarePoysha": 8250,
      "subtotalPoysha": 8250,
      "discountPoysha": 1650,
      "finalFarePoysha": 6600
    }
  ]
}
```

---

#### `GET /driver/pools/history`

**Response `200`:**
```json
{
  "pools": [
    {
      "id": "p-001",
      "status": "COMPLETED",
      "seatsOccupied": 2,
      "startedAt": "...",
      "completedAt": "...",
      "passengers": [
        { "passengerName": "Nusrat", "status": "COMPLETED", "finalFarePoysha": 7440 },
        { "passengerName": "Rafiq", "status": "COMPLETED", "finalFarePoysha": 6600 }
      ]
    }
  ]
}
```

---

#### `GET /driver/pools/:id/history`

Full audit for every ride in a pool. Same shape as `/rides/:id/history` but grouped by pool.

---

#### `GET /driver/passengers/:id`

Passenger profile scoped to the requesting driver's pools.

**Response `200`:**
```json
{
  "passenger": {
    "id": "u-nusrat-001",
    "name": "Nusrat",
    "email": "nusrat@example.com",
    "role": "PASSENGER",
    "joinedAt": "2026-09-23T08:05:00.000Z"
  },
  "stats": { "totalRides": 3, "totalFarePoysha": 22320 },
  "ridesWithYou": [
    {
      "rideRequestId": "...",
      "pickupZone": "Banani",
      "destinationZone": "Mohakhali",
      "status": "COMPLETED",
      "finalFarePoysha": 7440,
      "requestedAt": "..."
    }
  ]
}
```

**Errors:** `400 NOT_A_PASSENGER`, `404 PASSENGER_NOT_FOUND`.

---

### Test-Only

---

#### `POST /test/reset`

Only mounted when `NODE_ENV=test`. Wipes rides, pools, and history; resets Teslas to offline.

---

## 13. Error Handling

All errors are formatted uniformly:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message.",
  "details": { ... }   // optional
}
```

### Standard Codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | Zod rejected the body |
| 400 | `SAME_ZONE` | Pickup = destination |
| 401 | `UNAUTHENTICATED` | No token or invalid token |
| 401 | `INVALID_CREDENTIALS` | Wrong email/password |
| 403 | `FORBIDDEN` | Role or ownership violation |
| 404 | `RIDE_NOT_FOUND`, `ZONE_NOT_FOUND`, `POOL_NOT_FOUND`, `USER_NOT_FOUND` | Resource missing |
| 409 | `EMAIL_TAKEN` | Signup conflict |
| 409 | `INVALID_TRANSITION` | State machine violation |
| 409 | `POOL_FULL` | Capacity exceeded |
| 409 | `CLUSTER_MISMATCH` | Different corridor |
| 409 | `SAME_ZONE` | Pickup = destination |
| 500 | `INTERNAL_ERROR` | Unexpected |

### Centralized Handler

```ts
// src/middleware/error.handler.ts
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'VALIDATION_ERROR', ... });
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.code, message: err.message });
  logger.error('error', `Unhandled: ${req.method} ${req.originalUrl}`, {}, err);
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}
```

---

## 14. Logging

### Logger

Structured logger in `src/app/lib/logger.ts`:

- **Development**: colored terminal output + optional file at `logs/YYYY-MM-DD.log`
- **Production**: JSON one-liners to stdout (captured by the hosting platform)
- **Test**: warn + error only by default; `LOG_LEVEL=debug` shows everything

### Request IDs

Every request gets a short ID (`rid`) attached by `requestLogger`. All log lines for that request carry the same `rid`, so you can trace a full request lifecycle.

### Example

```
14:22:05.120 DEBUG http   → POST /api/v1/auth/login  {"rid":"a1b2c3d4"}
14:22:05.165 DEBUG http   ← 200 POST /api/v1/auth/login 45ms  {"rid":"a1b2c3d4"}
```

### Environment Flags

| Variable | Effect |
|----------|--------|
| `LOG_LEVEL=debug\|info\|warn\|error` | Minimum level |
| `LOG_FILE=0` | Disable file output in dev |
| `NO_COLOR=1` | Disable ANSI colors |

---

## 15. Testing

### Run

```bash
bun test                 # all tests
bun test auth            # just auth
bun test --watch         # watch mode
```

### Coverage

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `auth.test.ts` | 8 | signup, login, logout, me, validation, duplicate email |
| `zones.test.ts` | 3 | list, sorted, all clusters |
| `rides.test.ts` | 14 | create, preview, ownership, cancel, strict validation |
| `fare.test.ts` | 11 | haversine, circuity, per-seat, pool discount |
| `driver.test.ts` | 13 | status toggle, requests, active pool, profile |
| `pooling.test.ts` | 14 | accept, join, capacity, cluster rule, lifecycle, concurrency |
| `history.test.ts` | 7 | audit trail, per-pool history, ownership |

**Total: ~70 tests.**

### Concurrency Test

```ts
it('two parallel accepts for the last seat: exactly one succeeds', async () => {
  // Setup: 2 seats filled
  // Two new rides for the last seat
  const [r1, r2] = await Promise.all([
    request(app).post(`/api/v1/driver/requests/${c}/accept`).set('Cookie', jashimCookie),
    request(app).post(`/api/v1/driver/requests/${d}/accept`).set('Cookie', jashimCookie),
  ]);
  expect([r1.status, r2.status].sort()).toEqual([200, 409]);
});
```

### Timeouts

Remote DB (Neon) adds latency. Slow tests use `SLOW_TEST_TIMEOUT = 30_000` from `tests/helpers/timeouts.ts`.

---

## 16. Environment Variables

**`.env`** (backend):

```bash
# Neon pooled URL for runtime
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
# Neon direct URL for migrations
DIRECT_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# Auth
JWT_SECRET=<32+ char random string>
JWT_EXPIRES_IN=24h

# Server
PORT=5000
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development

# Logging
LOG_LEVEL=debug
```

**Never commit `.env`.** Use `.env.example` as the template.

---

## 17. Deployment

### Local Docker

```bash
# From repo root
docker compose up --build
# API on http://localhost:5000
```

See `Dockerfile` for the multi-stage build.

### Vercel

**Backend project settings:**

| Setting | Value |
|---------|-------|
| Root Directory | `backend` |
| Install Command | `bun install` |
| Build Command | `bun run build` (runs tsup) |
| Output Directory | `dist` |

**Environment variables:**

```
NODE_ENV=production
PORT=5000
CORS_ORIGIN=https://your-frontend.vercel.app
DATABASE_URL=<Neon pooled>
DIRECT_URL=<Neon direct>
JWT_SECRET=<random>
JWT_EXPIRES_IN=24h
```

**Important:** for cross-origin deployments (frontend and backend on different Vercel domains), the frontend must proxy `/api/*` to the backend via Next.js rewrites. This keeps cookies first-party.

---

## 18. Known Limitations

- **Distance is approximate.** Haversine × 1.4, ±15% vs. real roads.
- **No traffic awareness.** Rush-hour costs the same as 3 AM.
- **No routing engine.** Straight-line approximation, not turn-by-turn.
- **Pool discount depends on completion-time composition.** If a co-passenger cancels mid-trip, the remaining passenger's fare may revert to solo.
- **No idempotency keys.** A client retry could double-submit.
- **No rate limiting.** Public endpoints are unprotected against abuse.
- **Single vehicle per driver.** No fleet management.

---

## 19. Next Improvements

1. **Pre-computed zone-pair distance matrix.** 28 unique pairs for 8 zones. Free, accurate, no external API. Look up at request time; fall back to haversine × 1.4 if missing.
2. **Real routing** via OSRM (self-hosted) or GraphHopper.
3. **Lock fares at trip start** instead of completion — removes the "co-passenger cancelled" surprise.
4. **Idempotency keys** on `/accept` and `/rides`.
5. **Rate limiting** on `/auth/*` (e.g., 5 attempts / 5 min).
6. **Refresh tokens** with rotation for better session security.
7. **WebSocket or SSE** for real-time status updates instead of polling.
8. **Payments ledger** if wallet balance history becomes a real requirement.


