# Self-Hosting on Node.js

This guide covers running the app as a plain Node.js server (`node-server` Nitro preset),
outside Cloudflare Workers. For Workers, see [NUXTHUB_SELF_HOSTED.md](NUXTHUB_SELF_HOSTED.md).

You need:

- Node.js 22 and pnpm
- a PostgreSQL database
- a writable, persistent directory for sessions (see [Sessions and KV](#2-sessions-and-kv)), or a Redis server

---

## 1. Database migrations

`server/db/migrations` is listed in `.gitignore`: a fresh clone has no migration files. Generate
them from the Drizzle schema (`server/db/schema/`); this step does not connect to the database:

```bash
pnpm db:generate
```

This runs `drizzle-kit generate` with `server/db/drizzle.config.ts` and writes
`server/db/migrations/0000_<name>.sql` plus a `meta/` folder. If you deploy from CI or from another
checkout, commit these files in your own repository (or remove the `server/db/migrations` line from
`.gitignore`), so that every build applies the same migrations.

### Apply them through NuxtHub only

Two tools can apply these files, and each keeps its own tracking table:

| Command | Applied by | Tracking table |
|---------|-----------|----------------|
| `npx nuxt db migrate`, `pnpm dev`, `pnpm build` | NuxtHub | `_hub_migrations` |
| `pnpm db:migrate` | drizzle-kit | `drizzle.__drizzle_migrations` |

NuxtHub applies pending migrations on its own whenever `DATABASE_URL` is set: when the dev server
starts, and at the end of `pnpm build`. Mixing both tools on one database fails, because each one
sees the other's migrations as pending and stops with `relation "…" already exists`.

Use NuxtHub for every environment:

```bash
# apply pending migrations without building
DATABASE_URL=postgres://user:password@host:5432/database npx nuxt db migrate
```

Running it again prints `Database migrations up to date`. If the database was already migrated
with `pnpm db:migrate`, record the existing migrations in `_hub_migrations` once instead of
applying them again:

```bash
npx nuxt db mark-as-migrated 0000_<name>
```

> If `DATABASE_URL` is set when you run `pnpm build`, the build connects to that database and
> applies the pending migrations to it. Build against the database you deploy to, or migrate it
> separately with `npx nuxt db migrate`.

---

## 2. Sessions and KV

The app does not use Redis directly: `NUXT_REDIS_URL` (`runtimeConfig.redisUrl`) is not read by
any code. Better Auth keeps its sessions in NuxtHub KV (`hub:kv`, used as `secondaryStorage`), and
NuxtHub chooses the KV driver **when the app is built**:

| Build environment | KV driver |
|-------------------|-----------|
| `REDIS_URL` set (or `KV_URL` starting with `rediss://`) | Redis, through `ioredis` |
| `NUXT_NITRO_PRESET=cloudflare-module` | Cloudflare KV binding `KV` |
| none of the above | `fs-lite`, files under `.data/kv` |

The driver and its options, including the Redis URL, are written into the build output. Changing
them means building again.

With the default `fs-lite` driver, `.data/kv` is resolved from the **working directory of the
server process**. It holds the sessions: keep it writable and persistent (a volume, in a
container); losing it signs every user out. Run a single instance with it; for
several instances behind a load balancer, build with `REDIS_URL` so that they share sessions.

---

## 3. Build

```bash
NUXT_NITRO_PRESET=node-server pnpm build
```

Most settings are read from the environment (or `.env`) while `pnpm build` runs and stored in
`.output`, so build with the same values you run with. See [`.env.example`](../.env.example) for
the full list; the main ones are `NUXT_APP_URL`, `NUXT_APP_NAME`, `NUXT_BETTER_AUTH_SECRET`,
`DATABASE_URL`, `NUXT_RESEND_API_KEY`, the `NUXT_STRIPE_*` keys and the OAuth client IDs.

`DATABASE_URL` is required by the build itself: without it, NuxtHub falls back to a PGlite
database, whose package is not installed, and the build fails with
`Cannot find package '@electric-sql/pglite'`. With it, the build applies the pending migrations
to that database (see [Database migrations](#1-database-migrations)).

---

## 4. Run

The build output is self-contained: copy `.output/` to the server and start it with Node.js.

```bash
PORT=3000 node .output/server/index.mjs   # or: pnpm serve
```

Nuxt also reads runtime overrides when the server starts: every `runtimeConfig` key can be
replaced by `NUXT_` followed by its path in upper snake case, and public keys by `NUXT_PUBLIC_`.
For example:

| `runtimeConfig` key | Runtime variable |
|---------------------|------------------|
| `databaseUrl` | `NUXT_DATABASE_URL` |
| `betterAuthSecret` | `NUXT_BETTER_AUTH_SECRET` |
| `resendApiKey` | `NUXT_RESEND_API_KEY` |
| `public.appName` | `NUXT_PUBLIC_APP_NAME` |

Some names differ from the ones read at build time (`NUXT_APP_URL` at build becomes
`NUXT_PUBLIC_BASE_URL` at runtime, `NUXT_GH_CLIENT_ID` becomes `NUXT_GITHUB_CLIENT_ID`), and a few
values are only read at build time. Making every setting configurable at runtime is tracked in
[#10](https://github.com/HouseOfBetterAuth/nuxt-better-auth-saas/issues/10); this section will
be updated once it lands.

The server currently refuses to start without `NUXT_RESEND_API_KEY` (`Missing API key`); making
optional services optional is tracked in
[#11](https://github.com/HouseOfBetterAuth/nuxt-better-auth-saas/issues/11).

---

## 5. Create an admin user

`create-admin.ts` signs up a user with email and password, marks the email as verified and gives it
the `admin` role. It reads `DATABASE_URL` (or `NUXT_DATABASE_URL`), `NUXT_ADMIN_EMAIL` and
`NUXT_ADMIN_PASSWORD`, from the environment or `.env`. Run it once the migrations are applied:

```bash
node create-admin.ts        # Node.js 22.18 or later runs TypeScript directly
```

Running it again for an existing email only sets the role and the verified flag.
