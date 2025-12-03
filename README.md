<p align="center">
  <img src="/public/quillio-logo.png" alt="Quillio" height="80" />
  &nbsp;&nbsp;&nbsp;
  <strong style="font-size: 2em;">Quillio</strong>
</p>

<p align="center">
  <em>Create SEO-ready blogs from YouTube</em>
</p>

<p align="center">
  Transform YouTube videos into SEO-optimized blog posts automatically.<br/>
  Powered by AI and built with modern web technologies.
</p>

---

## Quillio

Create SEO-ready blogs from YouTube videos. Transform video content into well-structured, search-engine optimized articles automatically.

> **Note:** This template is opinionated and built for my own apps. It's designed specifically for:
> - **Stripe-only billing** — Polar and other payment providers will not be supported
> - **Multi-tenant orgs** — each user can own multiple organizations, but only the first org gets a free trial
> - **No single-tenant mode** — this is not designed for single-user or personal-use SaaS apps
>
> Feel free to fork and adapt, but these constraints are intentional and won't change.

### What's Included

- [x] **YouTube Video Ingestion** — Automatically extract transcripts and metadata from YouTube videos
- [x] **AI-Powered Blog Generation** — Transform video content into well-structured, SEO-optimized blog posts
- [x] **SEO Optimization** — Automatic title, description, keywords, and schema markup generation
- [x] **Content Chat Interface** — Interactive chat to refine and customize generated content
- [x] **Content Management** — Draft, edit, and publish blog posts with version control
- [x] **Section-by-Section Editing** — Edit individual sections of generated content
- [x] **Vector Search** — Semantic search across ingested video content for better context
- [x] **Multi-tenant Workspaces** — Organize content by organization with team collaboration
- [x] **Authentication** — Better Auth with email/password, OAuth (Google, GitHub), email verification
- [x] **Stripe Billing** — Subscriptions with seat-based pricing for team plans
- [x] **Team Collaboration** — Invite team members, manage roles and permissions
- [x] **API Access** — RESTful API for programmatic content generation
- [x] **Content Export** — Export generated content in markdown format
- [ ] **More Video Sources** — Support for additional video platforms
- [ ] **Bulk Processing** — Process multiple videos in batch
- [ ] **Custom Templates** — Customizable blog post templates

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
# 1. Clone the repository
git clone https://github.com/paulchrisluke/quill-nuxsaas.git
cd quill-nuxsaas

# 2. Use Node.js v22 LTS
nvm use

# 3. Setup environment variables
cp .env.example .env   # Fill in env vars (database, Stripe, auth, etc.)

# 4. Install dependencies
pnpm install

# 5. Generate and apply database migrations
pnpm run db:generate
pnpm run db:migrate

# 6. Start development server
pnpm run dev -o
```

## 🚀 Deployment

### Database Migrations
Before deploying to production, ensure database migrations are applied:

```bash
# Generate migration files (if schema changed)
pnpm run db:generate

# Apply migrations to database
pnpm run db:migrate
```

**Important**: Run migrations before deploying your application to ensure the database schema is up-to-date. This is especially important for the `isAnonymous` column added to the user table for anonymous session support.

**Deploy to NuxtHub:**

```bash
# Build the project
pnpm build

# Deploy to NuxtHub
npx nuxthub deploy
```

**Note:** 
- NuxtHub automatically manages Workers, KV, and other Cloudflare resources
- Make sure you have a NuxtHub project linked (run `npx nuxthub link` if needed)
- Environment variables should be set in your NuxtHub project dashboard

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

### NuxtHub Setup

**Required Resources:**

1. **Create a NuxtHub Project:**
   - Go to [NuxtHub Dashboard](https://hub.nuxt.com) and create a new project
   - Link your project: `npx nuxthub link`
   - NuxtHub will automatically manage Workers, KV, and other Cloudflare resources

2. **Configure Bindings:**
   - **KV Namespace:** Automatically managed by NuxtHub
   - **R2 Bucket (optional):** Configure in NuxtHub dashboard if using R2 storage
   - **Hyperdrive:** Set `NUXT_CF_HYPERDRIVE_ID` environment variable in NuxtHub dashboard
     - Points to your PostgreSQL database for connection pooling

3. **Set Environment Variables:**
   - Add all required environment variables in NuxtHub project dashboard
   - Key variables: `NUXT_APP_URL`, `NUXT_DATABASE_URL`, `NUXT_BETTER_AUTH_SECRET`, `NUXT_STRIPE_SECRET_KEY`, `NUXT_CF_HYPERDRIVE_ID`, etc.

**Recommended Stack:**
- **NuxtHub** — managed Cloudflare Workers deployment
- **Neon Postgres** — serverless PostgreSQL database
- **Cloudflare Hyperdrive** — connection pooling for Postgres (configured via `NUXT_CF_HYPERDRIVE_ID`)
- **Cloudflare KV** — session caching and rate limiting (automatically managed by NuxtHub)
- **Cloudflare R2** — file storage for uploads (optional, configured in NuxtHub)

The app automatically uses Cloudflare KV and other bindings when deployed via NuxtHub.

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
  <em>Built by <a href="https://getquillio.com">Quillio</a></em>
</p>
