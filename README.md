<p align="center">
  <img src="/public/HouseOfBetterAuth.png" alt="HouseOfBetterAuth" height="80" />
  &nbsp;&nbsp;&nbsp;
  <strong style="font-size: 2em;">HouseOfBetterAuth</strong>
</p>

<p align="center">
  <em>Open-source SaaS starters powered by Better Auth</em>
</p>

<p align="center">
  We build production-ready, open-source SaaS templates using <a href="https://better-auth.com">Better Auth</a>.<br/>
  Skip the boilerplate. Ship faster.
</p>

---

## House of Better Auth Nuxt SaaS Starter

A production-ready Nuxt SaaS starter with authentication, billing, teams, and more.

> **Note:** This template is opinionated and built for my own apps. It's designed specifically for:
> - **Stripe-only billing** — Polar and other payment providers will not be supported
> - **Multi-tenant orgs** — each user can own multiple organizations, but only the first org gets a free trial
> - **No single-tenant mode** — this is not designed for single-user or personal-use SaaS apps
>
> Feel free to fork and adapt, but these constraints are intentional and won't change.

### What's Included

- [x] **Authentication** — Better Auth with email/password, OAuth (Google, GitHub), email verification
- [x] **Multi-tenant orgs** — create/switch orgs, one free trial per account
- [x] **Roles & permissions** — Owner, Admin, Member with granular access control
- [x] **Stripe billing** — subscriptions, seat-based pricing, legacy price support
- [x] **Billing previews** — see prorated charges before seat/plan changes
- [x] **Invoice history** — view and download past invoices
- [x] **Failed payment handling** — grace periods, recovery flows, warning banners
- [x] **Team invites** — invite by email, works for new and existing users
- [x] **User profiles** — avatar upload, email change, password management
- [x] **Session management** — view/revoke active sessions
- [x] **API keys** — per-org keys with expiration options
- [x] **Admin tools** — user impersonation, soft-ban
- [x] **Transactional emails** — React Email + Resend for all auth/billing events
- [x] **Timezone support** — per-org timezone settings
- [x] **Referral tracking** — track user and org referrals for attribution
- [x] **Connected accounts** — link/unlink multiple OAuth providers
- [x] **Account deletion** — secure deletion with email verification
- [ ] **More Testing** — I'm sure there are some bugs, will actively test and make updates.
- [x] **NuxtHub self-hosted** — self-hosted deployment guide (see below)
- [ ] **Abandoned cart emails** — email users with incomplete subscription status
- [ ] **Usage-based billing** — metered billing support

<p align="center">
  <img src="/public/screenshots/home.png" alt="Homepage" width="80%" />
</p>

<p align="center">
  <img src="/public/screenshots/dashboard.png" alt="Dashboard" width="80%" />
</p>

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Nuxt 4 + Vue 3 + TypeScript |
| Auth | Better Auth |
| Database | PostgreSQL + Drizzle ORM + Cloudflare Hyperdrive |
| Billing | Stripe (subscriptions, seats, plan versioning) |
| Emails | React Email + Resend |

---

## Quick Start

```bash
cp .env.example .env   # Fill in env vars (database, Stripe, auth, etc.)
pnpm install
pnpm run db:generate
pnpm run db:migrate
pnpm run dev -o
```

**Deploy to production:**

```bash
npx nuxthub deploy
```

### Environment Variables

**Important:** Set `NUXT_APP_URL` to your production URL for Better Auth to work correctly.

```bash
# .env
NUXT_APP_URL=https://yourdomain.com
```

This URL is used by Better Auth for:
- OAuth callback URLs
- Email verification links
- Password reset links
- CORS origin validation

The origin is configured in `server/utils/auth.ts`:

```typescript
export const createBetterAuth = () => betterAuth({
  baseURL: runtimeConfig.public.baseURL,
  trustedOrigins: [
    'http://localhost:8787',
    'http://localhost:3000',
    // ... other local origins
    runtimeConfig.public.baseURL  // Your production URL
  ],
  // ...
})
```

Your `NUXT_APP_URL` is automatically added to `trustedOrigins` via `runtimeConfig.public.baseURL`.

### Recommended Hosting

**Recommended stack:**
- **Cloudflare Workers** — serverless hosting via [NuxHub](https://hub.nuxt.com)
- **Neon Postgres** — serverless PostgreSQL database
- **Cloudflare Hyperdrive** — connection pooling for Postgres

**Caching:**
- **Cloudflare KV** — no Redis needed when hosting on Cloudflare (used for session caching, rate limiting)
- **Redis** — use Redis if you're not on Cloudflare (Upstash, Railway, Vercel etc.)

The app automatically uses Cloudflare KV when deployed to Cloudflare Workers. No additional configuration needed.

---

<details>
<summary><h2>🚀 NuxtHub Self-Hosted Deployment</h2></summary>

This project supports **self-hosted Cloudflare Workers** deployment instead of using NuxtHub Admin. This gives you full control over your infrastructure.

### Prerequisites

- Cloudflare account with Workers enabled
- PostgreSQL database (e.g., Neon, Supabase)
- Cloudflare resources:
  - **KV Namespace** — for caching
  - **R2 Bucket** — for file storage
  - **Hyperdrive** — for PostgreSQL connection pooling

### Quick Setup

#### 1. Create Wrangler Config

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Edit `wrangler.jsonc` with your resource IDs:

```jsonc
{
    "name": "your-worker-name",  // ⚠️ Must match your Cloudflare Worker name
    "kv_namespaces": [{ "binding": "KV", "id": "<your-kv-id>" }],
    "r2_buckets": [{ "binding": "BLOB", "bucket_name": "<your-bucket>" }],
    "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<your-hyperdrive-id>" }]
}
```

#### 2. Get Resource IDs

```bash
npx wrangler kv namespace list
npx wrangler r2 bucket list
npx wrangler hyperdrive list
```

#### 3. Environment Variables

> **Important:** `DATABASE_URL` replaces the old `NUXT_DATABASE_URL`

```bash
# .env
DATABASE_URL=postgres://user:password@host:5432/database
NUXT_NITRO_PRESET=cloudflare-module
```

#### 4. Mark Existing Migrations

If your database already has tables, mark migrations as applied:

```bash
npx nuxt db mark-as-migrated 0000_your_migration_name
```

#### 5. Build & Deploy

```bash
pnpm build
npx wrangler deploy
```

### How It Works

| Environment | Database | Cache |
|-------------|----------|-------|
| Cloudflare Workers | Hyperdrive | KV |
| Node.js hosting | `DATABASE_URL` | Redis |

### Full Documentation

See [docs/NUXTHUB_SELF_HOSTED.md](docs/NUXTHUB_SELF_HOSTED.md) for complete setup guide.

See [docs/MIGRATION_CHECKLIST.md](docs/MIGRATION_CHECKLIST.md) for migration checklist when syncing with your own app.

</details>

---

## Features

### Billing & Subscriptions

- **Stripe-powered billing** with monthly/yearly Pro plans
- **Legacy pricing support** — existing subscribers stay on their original price forever
- **Seat-based pricing** — base plan includes 1 seat, extra members cost per-seat
- **Detailed previews** before any billing change (seat changes, plan switches, trial conversions)
- **Invoice history** with pagination and PDF downloads
- **Declined card handling** with graceful recovery flows
- **Grace period support** for failed payments before auto-cancellation

#### Stripe Subscription Status Flow

| Status | When | What Happens |
|--------|------|--------------|
| `incomplete` | User opens Stripe Checkout but doesn't complete payment | Waiting for initial payment — use for retargeting abandoned checkouts |
| `trialing` | User starts a free trial | Full access during trial period |
| `active` | Payment succeeds (after trial or direct subscribe) | Full access, billing active |
| `past_due` | Payment fails on renewal | Grace period — user sees warning banners, can update payment method |
| `canceled` | Grace period ends or user canceled and billing cycle current date is past the billing cycle end date | Stripe sends webhook, access revoked, excess team members removed |

**How it works:**
1. When a payment fails, Stripe sets `status = "past_due"` and retries automatically
2. During the grace period (configured in Stripe Dashboard), users see warning banners and can update their payment method
3. If payment isn't resolved, Stripe sends a webhook after the grace period and sets `status = "canceled"`
4. On cancellation, the app downgrades the org to free tier and removes excess team members


#### Stripe Webhook Setup

**Webhook endpoint:** `https://yourdomain.com/api/auth/stripe/webhook`

Enable these webhooks in your Stripe Dashboard:

| Event | Purpose |
|-------|---------|
| `checkout.session.completed` | Handle completed checkout sessions |
| `customer.created` | Track new Stripe customers |
| `customer.subscription.created` | New subscription created |
| `customer.subscription.deleted` | Subscription ended/canceled |
| `customer.subscription.trial_will_end` | Trial ending soon (3 days before) |
| `customer.subscription.updated` | Plan changes, status updates |
| `invoice.payment_failed` | Payment declined |
| `invoice.payment_succeeded` | Payment successful |
| `payment_intent.payment_failed` | Payment method or payment attempt failed |

<p align="center">
  <img src="/public/screenshots/subscription.png" alt="Subscription Management" width="70%" />
</p>

<details>
<summary>More billing screenshots</summary>

![Trial to Paid Seat Preview](/public/screenshots/trial-to-2-seats-preview.png)
![Invoice History](/public/screenshots/invoices-1.png)
![Seat Change Preview](/public/screenshots/billing-invite-seat-preview.png)
![Failed Payment UI](/public/screenshots/failed-payment-upgrade-ui.png)

</details>

---

### Organizations & Teams

- **Multi-org support** — each org requires its own subscription
- **14-day free trial** on first org, no trial on subsequent orgs
- **Role-based access** — Owner, Admin, Member with granular permissions
- **Invite system** — works for both new and existing users
- **Timezone per org** — billing dates and timestamps display correctly

<p align="center">
  <img src="/public/screenshots/org-settings-with-timezones.png" alt="Org Settings" width="70%" />
</p>

<details>
<summary>More org screenshots</summary>

![Create New Org](/public/screenshots/org-switcher-create-new-org.png)
![One Free Org Per Account](/public/screenshots/org-switcher-one-free-org-per%20account-1.png)
![Invite Members Step 1](/public/screenshots/invite-members-1.png)
![Invite Members Step 2](/public/screenshots/invite-members-2.png)
![Invite Members Step 3](/public/screenshots/invite-members-3.png)

</details>

---

### User Management

- **Profile settings** — avatar upload, email change, password management
- **Connected accounts** — link/unlink OAuth providers (Google, GitHub)
- **Session management** — view and revoke active sessions
- **Account deletion** with email verification
- **Stripe sync** — email/name changes automatically update Stripe customer

<p align="center">
  <img src="/public/screenshots/profile-settings-change-email-password-sessions-connected-accounts.png" alt="Profile Settings" width="70%" />
</p>

---

### Admin Tools

- **User impersonation** for support
- **Soft-ban / restrict** abusive accounts
- **API keys** — per-user or per-org with expiration options

<details>
<summary>Admin screenshots</summary>

![Impersonate User Step 1](/public/screenshots/Impersonate-1.png)
![Impersonate User Step 2](/public/screenshots/Impersonate-2.png)
![Pro Badge](/public/screenshots/pro-badge.png)
![Admin Users Panel](/public/screenshots/users.webp)
![API Key Creation](/public/screenshots/org-settings-api-key-1.png)
![API Key Created](/public/screenshots/org-settings-apit-key-2.png)

</details>

---

### Transactional Emails

Built with React Email + Resend.

| Email | Trigger |
|-------|---------|
| Verify Email | Sign up or email change |
| Reset Password | Forgot password request |
| Delete Account | Account deletion request |
| Team Invite | User invited to org |
| Trial Started | Free trial begins |
| Subscription Confirmed | Trial ends successfully or direct subscribe |
| Subscription Updated | Seat or plan changes |
| Payment Failed | Card declined |
| Subscription Canceled/Expired | Downgrade or grace period ends |

<details>
<summary>Email screenshots</summary>

![Add Seats Email](/public/screenshots/email-add-seats-confirmation.png)
![Monthly to Yearly Email](/public/screenshots/email-monthly-to-yearly-confirmation.png)
![Failed Payment Email](/public/screenshots/failed-payment-email-react-email-resend.png)

</details>

---

### Authentication

<p align="center">
  <img src="/public/screenshots/signin.png" alt="Sign In" width="45%" />
  <img src="/public/screenshots/pricing.png" alt="Pricing" width="45%" />
</p>

---

## Configuring Plans

Plans are defined in `shared/utils/plans.ts` — the single source of truth for pricing, features, and Stripe price IDs.

```typescript
export const PLANS = {
  PRO_MONTHLY: {
    id: 'pro-monthly-v2',
    priceId: 'price_yyy',        // Your Stripe Price ID
    key: 'pro',
    interval: 'month',
    label: 'Monthly',
    priceNumber: 11.99,
    seatPriceNumber: 5.99,
    trialDays: 14,
    features: ['Feature 1', 'Feature 2']
  },
  PRO_YEARLY: {
    id: 'pro-yearly-v2',
    priceId: 'price_zzz',
    key: 'pro',
    interval: 'year',
    label: 'Yearly',
    priceNumber: 99.99,
    seatPriceNumber: 44.44,
    description: 'Save ~45%',
    trialDays: 14,
    features: ['Feature 1', 'Feature 2']
  }
}
```

**Helper functions:**

```typescript
import { findPlanById, findPlanByPriceId, normalizePlanId } from '~~/shared/utils/plans'

findPlanById('pro-monthly-v2')
findPlanByPriceId('price_xxx')
normalizePlanId('pro-monthly-v2-no-trial') // → 'pro-monthly-v2'
```

### Legacy Pricing

Keep old plan entries in the file — existing subscribers are matched by `priceId` and stay on their original pricing. If they cancel and re-subscribe, they get current pricing.

---

## Reusable Components

**Billing:**
- `usePaymentStatus()` — check `isPaymentFailed`, `hasUsedTrial`, `activeSub`
- `<BillingPaymentFailedBanner />` — global warning banner
- `<BillingPaymentFailedCard />` — action card with payment update buttons

**Settings:**
- `<SettingsGeneralSection />` — org name, slug, timezone
- `<SettingsApiKeysSection />` — API key management
- `<SettingsSessionsSection />` — active sessions
- `<SettingsDangerZone />` — leave/delete org

**Members:**
- `<MembersInviteForm />` — invite with seat limit checking
- `useTimezone()` — timezone list and formatting

---

## Acknowledgments

This project is a fork of the original [NuxSaaS](https://github.com/NuxSaaS/NuxSaaS) by the NuxSaaS team. Thank you for the foundation!

---

## License

MIT. See [LICENSE](LICENSE).

---

<p align="center">
  <em>Built by <a href="https://github.com/HouseOfBetterAuth">HouseOfBetterAuth</a></em>
</p>
