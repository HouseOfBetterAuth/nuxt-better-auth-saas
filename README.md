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

## NuxSaaS

A production-ready Nuxt SaaS starter with authentication, billing, teams, and more.

> **Note:** This template is opinionated and built for my own apps. It's designed specifically for:
> - **Stripe-only billing** — Polar and other payment providers will not be supported
> - **Multi-tenant orgs** — each user can own multiple organizations, but only the first org gets a free trial
> - **No single-tenant mode** — this is not designed for single-user or personal-use SaaS apps
>
> Feel free to fork and adapt, but these constraints are intentional and won't change.

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
