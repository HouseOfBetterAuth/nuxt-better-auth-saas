# NuxtHub Self-Hosted Deployment Guide

This guide covers deploying your NuxtHub application to **self-hosted Cloudflare Workers** instead of using NuxtHub Admin.

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed (`pnpm add -D wrangler`)
- PostgreSQL database (e.g., Neon, Supabase, or self-hosted)
- Cloudflare resources created:
  - **KV Namespace** — for caching (replaces Redis)
  - **R2 Bucket** — for file/blob storage
  - **Hyperdrive** — for PostgreSQL connection pooling

---

## Setup

### 1. Create Your Wrangler Configuration

Copy the example template and fill in your resource IDs:

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Edit `wrangler.jsonc` with your Cloudflare resource IDs:

```jsonc
{
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "your-worker-name",  // ⚠️ Must match your Cloudflare Worker name
    "main": "./.output/server/index.mjs",
    "compatibility_date": "2025-12-10",
    "assets": {
        "directory": "./.output/public/",
        "binding": "ASSETS"
    },
    "observability": {
        "enabled": true
    },
    "r2_buckets": [
        {
            "binding": "BLOB",
            "bucket_name": "<your-r2-bucket-name>"
        }
    ],
    "kv_namespaces": [
        {
            "binding": "KV",
            "id": "<your-kv-namespace-id>"
        }
    ],
    "hyperdrive": [
        {
            "binding": "HYPERDRIVE",
            "id": "<your-hyperdrive-config-id>"
        }
    ]
}
```

### 2. Get Your Cloudflare Resource IDs

Run these commands to find your resource IDs:

```bash
# List KV namespaces
npx wrangler kv namespace list

# List R2 buckets
npx wrangler r2 bucket list

# List Hyperdrive configs
npx wrangler hyperdrive list
```

### 3. Set Environment Variables

Update your `.env` file:

```bash
# Database connection (used for local dev and as Hyperdrive fallback)
DATABASE_URL=postgres://user:password@host:5432/database

# Cloudflare preset
NUXT_NITRO_PRESET=cloudflare-module
```

> **Important:** `DATABASE_URL` replaces the old `NUXT_DATABASE_URL`. Make sure to update your `.env` file.

### 4. Configure Secrets in Cloudflare

Set your secrets via Wrangler:

```bash
npx wrangler secret put NUXT_BETTER_AUTH_SECRET
npx wrangler secret put NUXT_STRIPE_SECRET_KEY
npx wrangler secret put NUXT_STRIPE_WEBHOOK_SECRET
npx wrangler secret put NUXT_RESEND_API_KEY
# ... add other secrets as needed
```

---

## Build & Deploy

### Build the Application

```bash
pnpm build
```

### Mark Existing Migrations as Applied

If your database already has tables from previous migrations, you must mark them as applied before deploying:

```bash
# List your migration files
ls server/db/migrations/

# Mark each migration as applied
npx nuxt db mark-as-migrated 0000_your_migration_name
npx nuxt db mark-as-migrated 0001_another_migration
# ... repeat for all existing migrations
```

> **Why?** NuxtHub v0.10 applies migrations during build. If your database already has the tables, the build will fail with "relation already exists" errors.

### Deploy to Cloudflare

```bash
npx wrangler deploy
```

Or use the npm script:

```bash
pnpm deploy
```

---

## Local Development

### Standard Local Dev

Uses `DATABASE_URL` directly (no Hyperdrive):

```bash
pnpm dev
```

### With Remote Cloudflare Bindings

Test with actual Cloudflare KV, R2, and Hyperdrive:

```bash
npx nuxt dev --remote
```

### Preview Production Build Locally

```bash
pnpm build
npx wrangler dev --cwd .output
```

---

## How It Works

### Database Connection

The app uses a smart connection strategy:

| Environment | Connection Source |
|-------------|-------------------|
| Cloudflare Workers (production) | Hyperdrive binding |
| Cloudflare Workers (local wrangler) | `DATABASE_URL` |
| Node.js hosting | `DATABASE_URL` |

Hyperdrive provides connection pooling for PostgreSQL on Cloudflare Workers, which is essential for serverless environments.

### Caching

| Environment | Cache Backend |
|-------------|---------------|
| Cloudflare Workers | KV Namespace |
| Node.js hosting | Redis (`NUXT_REDIS_URL`) |

The `cacheClient` in `server/utils/drivers.ts` automatically selects the appropriate backend.

### File Storage

| Environment | Storage Backend |
|-------------|-----------------|
| Cloudflare Workers | R2 Bucket |
| Node.js hosting | Local filesystem or S3 |

---

## Troubleshooting

### "relation already exists" Error

Your database already has tables. Mark migrations as applied:

```bash
npx nuxt db mark-as-migrated <migration-name>
```

### "Cannot find module 'hub:kv'" Error

This is an IDE error, not a build error. The `hub:kv`, `hub:db`, and `hub:blob` are virtual modules that only exist at build time. The build will work correctly.

### Worker Name Mismatch

Ensure the `name` in your `wrangler.jsonc` matches your Cloudflare Worker name exactly. Mismatches will create a new worker instead of updating the existing one.

### Hyperdrive Not Connecting

1. Verify your Hyperdrive config ID is correct
2. Check that your PostgreSQL allows connections from Cloudflare IPs
3. Ensure your database connection string in Hyperdrive is correct

---

## File Structure

```
├── wrangler.jsonc          # Your config (gitignored)
├── wrangler.example.jsonc  # Template for others
├── server/
│   ├── db/
│   │   ├── drizzle.config.ts
│   │   ├── schema/
│   │   └── migrations/
│   ├── types/
│   │   └── hub.d.ts        # Type declarations for hub:* modules
│   └── utils/
│       ├── drivers.ts      # Database, cache, and storage drivers
│       └── runtimeConfig.ts
└── nuxt.config.ts          # Hub configuration
```

---

## Useful Commands

```bash
# Build
pnpm build

# Deploy
npx wrangler deploy

# View logs
npx wrangler tail

# List deployments
npx wrangler deployments list

# Rollback
npx wrangler rollback

# Mark migration as applied
npx nuxt db mark-as-migrated (say yes to all)
```
