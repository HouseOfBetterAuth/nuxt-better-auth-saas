![HouseOfBetterAuth Logo](/public/HouseOfBetterAuth.png)

## HouseOfBetterAuth (Customized Fork)

Very small Nuxt-based SaaS starter I’m using for my own project.

![Homepage](/public/screenshots/home.webp)

![Dashboard](/public/screenshots/dashboard.webp)

### Features (What This Starter Actually Does)

- **Billing & Plans**  
  - Pro plan with monthly / yearly billing.  
  - **Legacy pricing aware**: you can raise prices for new customers while existing subscriptions **stay locked on their original (legacy) price**. When someone on a legacy plan downgrades, a warning explains that coming back later will use the newer, more expensive plan.  
  - Switching from monthly to yearly moves users onto the current standard yearly price.  
  - **Stripe-only**: billing is implemented against Stripe subscriptions/prices and expects Stripe webhooks to keep local subscription state in sync.

- **Detailed Billing Previews**  
  - **Seat Change Preview**: Before adding or removing seats, users see a detailed breakdown showing current vs. new pricing, prorated charges, and credits for unused time.  
  - **Plan Switch Preview**: When upgrading from monthly to yearly, users see the full payment breakdown including any credit for unused monthly time, the yearly plan cost, and the final prorated amount due.  
  - **Trial Ending Notices**: Clear messaging when adding team members will end a trial, explaining why payment is required.

![Trial to Paid Seat Preview](/public/screenshots/trial-to-2-seats-preview.png)

- **Invoice History**  
  - Lazy-loaded invoice history component on the billing page.  
  - Shows last 3 invoices by default with "Show more" pagination.  
  - Each invoice displays: invoice number, status badge (paid/open/draft), date, amount, and quick links to view or download PDF.  
  - Automatically refreshes after seat changes or plan switches to show new payments.

![Invoice History](/public/screenshots/invoices-1.png)

- **Declined Card Handling**  
  - Uses Stripe's `payment_behavior: 'error_if_incomplete'` to fail fast without leaving subscriptions in a broken state.  
  - When a payment fails during seat changes or plan switches, the subscription remains unchanged.  
  - User sees a toast notification explaining the card was declined.  
  - An "Update Payment Method" button appears in the modal, linking to the Stripe Customer Portal.  
  - Billing page shows a prominent red warning banner when subscription is `past_due`, warning that Pro access and team members will be lost if not resolved.  
  - "Manage Payment Method" button on billing page opens Stripe's hosted portal for secure card updates.  
  - **Reusable Components** (for template customization):  
    - `usePaymentStatus()` - Composable for checking `isPaymentFailed`, `hasUsedTrial`, `activeSub`, etc.  
    - `<BillingPaymentFailedBanner />` - Global warning banner for dashboard layout.  
    - `<BillingPaymentFailedCard />` - Detailed action card with update payment buttons.

![Failed Payment UI](/public/screenshots/failed-payment-upgrade-ui.png)

![Failed Payment Webhook](/public/screenshots/failed-payment-recurring-webhook.png)

- **Failed Payment Grace Period** (Stripe Dashboard Configuration)  
  - Configure in Stripe Dashboard → Settings → Billing → Subscriptions and emails.  
  - **Smart Retries**: Stripe automatically retries failed payments at optimal times.  
  - **Grace Period**: Set subscriptions to become `past_due` on failure, then auto-cancel after 7 days.  
  - During grace period: Users see warning banners, receive Stripe emails, and can update payment method.  
  - On cancellation: Webhook triggers `removeExcessMembersOnExpiration()` to downgrade team to free plan limits and removes any invited team members. Team members will have to be added again if the plan is reactivated.

- **Settings Page Components** (for template customization):  
  - `<SettingsGeneralSection />` - Organization name, slug, timezone settings.  
  - `<SettingsApiKeysSection />` - API key creation, listing, and deletion.  
  - `<SettingsSessionsSection />` - Trusted devices / active sessions management.  
  - `<SettingsDangerZone />` - Leave or delete organization actions.

![Org Settings with Timezones](/public/screenshots/org-settings-with-timezones.png)

![API Key Creation](/public/screenshots/org-settings-api-key-1.png)

![API Key Created](/public/screenshots/org-settings-apit-key-2.png)

![API Key Expiration](/public/screenshots/org-settings-api-key-expiration-3.png)

- **Members Page Components** (for template customization):  
  - `<MembersInviteForm />` - Invite form with seat limit checking, trial conversion, and upgrade flows.  
  - `useTimezone()` - Composable for timezone list and formatting utilities.

- **Organizations & Limits**  
  - First organization gets a **14-day free trial** of Pro features.  
  - **One trial per account**: Users who already own an organization do not get a free trial on subsequent organizations—they must pay immediately.  
  - Every additional organization requires its own Pro subscription.  
  - Good for "workspace per client" / "workspace per brand" setups.  
  - Trial eligibility is checked server-side and enforced via separate Stripe plan configurations (no-trial variants).

![Create New Org](/public/screenshots/org-switcher-create-new-org.png)

![One Free Org Per Account](/public/screenshots/org-switcher-one-free-org-per%20account-1.png)

![One Free Org Payment Required](/public/screenshots/org-switcher-one-free-org-per%20account-2.png)

- **Seats, Members & Invites**  
  - Pro plan is seat-based: base plan includes 1 seat, extra members cost per-seat.  
  - **Owners** can add/remove seats and preview the new price before confirming.  
  - **Admins** can invite members if seats are available, but cannot manage billing. If seats are full, they see a message to contact the team owner.  
  - Invitation links work for both **new** and **existing** users:  
    - If a user signs up from an invite, they land directly in the invited org instead of a confusing default personal team. 
    - If they already have an account, they can click the invite link any time to join the org.

![Subscription Management](/public/screenshots/subscription.webp)

![Seat Change Preview](/public/screenshots/billing-invite-seat-preview.png)

- **Referrals (Users & Orgs)**  
  - Basic tracking hooks for who referred a **user** and/or an **organization** (e.g. for attribution, rewards, or analytics).  
  - Can be extended to payouts or dashboards later.

- **Timezone Support**  
  - Per-organization timezone settings so billing dates, trials, and activity timestamps display correctly for each team.  
  - Full timezone list with search, stored at the org level.  
  - `useTimezone()` composable for formatting dates/times throughout the app.


- **Roles & Permissions**  
  - **Owner**: full control over org, billing, members, and dangerous actions.  
  - **Admin**: manage members and settings, but typically less billing power than the owner.  
  - **Member (read-only / limited)**: can use the product inside the org but cannot touch billing or sensitive admin actions.

- **User Profile Management**  
  - **Profile Settings Page** (`/profile`): Dedicated page for personal account settings, accessible from both desktop sidebar and mobile drawer.  
  - **Profile Picture Upload**: Upload, change, or remove profile pictures with drag-and-drop support. Initials fallback when no image is set.  
  - **Connected Accounts**: Link/unlink OAuth providers (Google, GitHub) to a single account.  
  - **Password Management**: Change password for credential users, or use forgot password flow for OAuth-only users to add a password.  
  - **Email Change with Stripe Sync**: When a team owner changes their email (with verification), Stripe customer email is automatically updated for all organizations they own.  
  - **Trusted Devices**: View and revoke active sessions from the profile page.  
  - **Account Deletion**: Users can delete their account with email verification for security.

![Profile Settings](/public/screenshots/profile-settings-change-email-password-sessions-connected-accounts.png)

- **Stripe Billing Sync**  
  - **Organization Name on Invoices**: Stripe customer name is set to the organization name (shows on invoices).  
  - **Auto-sync After Payments**: After subscription creation or updates, customer name is synced back to org name (prevents personal card names from overwriting).  
  - **Org Name Changes**: When organization name is updated in settings, Stripe customer name is automatically updated.  
  - **Owner Email Changes**: When an owner verifies a new email, Stripe customer email is updated for all their organizations.

- **Transactional Emails** (React Email + Resend)  

  #### Account Emails
  | Email | Trigger | Recipient |
  |-------|---------|-----------|
  | Verify Email | User signs up or changes their email | User |
  | Reset Password | User requests password reset via forgot password | User |
  | Delete Account | User requests account deletion | User |
  | Team Invite | User is invited to join an organization | Invited user |

  #### Billing Emails (sent to org owner)
  | Email | Trigger | Details |
  |-------|---------|--------|
  | Trial Started | `onTrialStart` - User starts a free trial | Includes trial duration and end date |
  | Subscription Confirmed | `onTrialEnd` (status=active) or `onSubscriptionComplete` (no trial) | Sent when trial ends with successful payment, or direct subscribe without trial |
  | Subscription Updated | `/api/stripe/update-seats` or `/api/stripe/change-plan` | Sent when user changes seats or switches plan (monthly → yearly) |
  | Trial Expired | `onTrialExpired` - Trial ends and payment fails | Prompts to update payment method |
  | Subscription Canceled | `onSubscriptionUpdate` (cancelAtPeriodEnd=true) | Sent when user clicks "Downgrade to Free", includes access end date |
  | Subscription Resumed | `/api/stripe/resume` endpoint | Sent when user resumes a canceled subscription |
  | Payment Failed | `payment_intent.payment_failed` webhook | Sent when a card is declined during subscription updates or renewals |
  | Subscription Expired | `onSubscriptionDeleted` webhook | Sent when subscription is deleted after grace period; notifies of downgrade to free, members removed, and 90-day data retention |

![Add Seats Email](/public/screenshots/email-add-seats-confirmation.png)

![Monthly to Yearly Email](/public/screenshots/email-monthly-to-yearly-confirmation.png)

![Failed Payment Email](/public/screenshots/failed-payment-email-react-email-resend.png)

- **Auth & Org Handling (Better Auth style)**  
  - Most auth, organization, and subscription flows are implemented the "Better Auth way", using its primitives and conventions.  
  - **Exception - Org-Level API Keys:** Better Auth's API key plugin doesn't natively support organization-scoped keys. This starter uses the `metadata` field in the API key schema to store `organizationId`, enabling per-org API keys with expiration options (7/30/60/90/180/365 days or never).

#### Invite Members Flow

![Invite Members Step 1](/public/screenshots/invite-members-1.png)

![Invite Members Step 2](/public/screenshots/invite-members-2.png)

![Invite Members Step 3](/public/screenshots/invite-members-3.png)

### Stack

- Nuxt 4 + Vue 3 + TypeScript
- Better Auth
- PostgreSQL + Drizzle ORM + Cloudflare Hyperdrive
- Stripe-based billing with seats and plan versions

### Getting Started

```bash
cp .env.example .env   # Fill in env vars (database, Stripe, auth, etc.)
pnpm install
pnpm run db:generate
pnpm run db:migrate
pnpm run dev -o
```

For production, build and serve:

```bash
npx nuxthub deploy
```

### Admin & Management Features

- Delete team / leave team flows (tied to **owner/admin/member** roles, with safety checks if you’re the last owner).
- User settings: API keys per user or per organization for external integrations.
- User settings: session management UI (see active sessions/devices, revoke sessions).
- Admin panel tools: impersonate users for support, soft-ban or restrict abusive accounts.

#### Admin Impersonation

![Impersonate User Step 1](/public/screenshots/Impersonate-1.png)

![Impersonate User Step 2](/public/screenshots/Impersonate-2.png)

#### Pro Badge & Users

![Pro Badge](/public/screenshots/pro-badge.png)

![Admin Users Panel](/public/screenshots/users.webp)

#### Authentication

![Sign In](/public/screenshots/signin.webp)

![Pricing](/public/screenshots/pricing.webp)

---

Inspired by the original NuxSaaS project: https://github.com/NuxSaaS/NuxSaaS (now HouseOfBetterAuth)

### Configuring Plans

Plans are defined in `shared/utils/plans.ts`. This file is the single source of truth for pricing, features, and Stripe price IDs.

```typescript
// shared/utils/plans.ts
export const PLANS = {
  // Legacy plans (for existing subscribers on old pricing)
  PRO_MONTHLY_V1: {
    id: 'pro-monthly-v1',
    priceId: 'price_xxx', // Your Stripe Price ID
    key: 'pro',
    interval: 'month',
    label: 'Monthly (Legacy)',
    priceNumber: 14.99,
    seatPriceNumber: 5.00,
    description: 'Billed monthly',
    trialDays: 14,
    features: [
      'Feature 1',
      'Feature 2',
      // ...
    ]
  },
  
  // Current plans (for new subscribers)
  PRO_MONTHLY: {
    id: 'pro-monthly-v2',
    priceId: 'price_yyy', // Your Stripe Price ID
    key: 'pro',
    interval: 'month',
    label: 'Monthly',
    priceNumber: 11.99,
    seatPriceNumber: 5.99,
    description: 'Billed monthly',
    trialDays: 14,
    features: [
      'Feature 1',
      'Feature 2',
      // ...
    ]
  },
  
  PRO_YEARLY: {
    id: 'pro-yearly-v2',
    priceId: 'price_zzz', // Your Stripe Price ID
    key: 'pro',
    interval: 'year',
    label: 'Yearly',
    priceNumber: 99.99,
    seatPriceNumber: 44.44,
    description: 'Billed yearly (Save ~45%)',
    trialDays: 14,
    features: [/* ... */]
  }
}
```

**Helper functions:**

```typescript
import { PLANS, findPlanById, findPlanByPriceId, normalizePlanId } from '~~/shared/utils/plans'

// Find plan by ID (handles -no-trial suffix automatically)
const plan = findPlanById('pro-monthly-v2')

// Find plan by Stripe price ID
const plan = findPlanByPriceId('price_xxx')

// Normalize plan ID (removes -no-trial suffix)
const normalizedId = normalizePlanId('pro-monthly-v2-no-trial') // 'pro-monthly-v2'
```

**How `plans.ts` works as a living database:**

This file acts as your **single source of truth** for all pricing configurations. Unlike a traditional database, it's version-controlled and deployed with your code, making price changes explicit and reviewable.

**Why keep legacy plans?**
- Existing subscribers remain on their original pricing forever (grandfathered)
- The app matches subscriptions by `priceId` from Stripe, so legacy plans must stay in the file
- Removing a legacy plan would break lookups for existing subscribers

**Adding new pricing:**
1. Create new prices in Stripe Dashboard
2. Add new plan entries (e.g., `PRO_MONTHLY_V3`) with the new `priceId`
3. Keep old plans in place - they're still needed for existing subscribers
4. The UI automatically shows the latest plans to new users (plans without `Legacy` in label)

**Legacy plan behavior:**
- Legacy subscribers see their original price on the billing page
- If they cancel and re-subscribe later, they get current (potentially higher) pricing
- A warning modal explains this before they confirm downgrade
- Switching monthly → yearly always uses current yearly pricing (no legacy yearly lock)

**Example flow:**
```
User A subscribes in 2024 at $14.99/mo (V1)
You raise prices to $19.99/mo (V2) in 2025
User A still pays $14.99/mo forever
User B subscribes in 2025 at $19.99/mo (V2)
If User A cancels and re-subscribes, they pay $19.99/mo (V2)
```

### License

MIT. See [LICENSE](LICENSE).

Documentation coming soon – if there's interest, I'll prioritize writing deeper docs and examples.
