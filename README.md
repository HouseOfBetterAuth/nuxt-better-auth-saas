## NuxSaaS (Customized Fork)

Very small Nuxt-based SaaS starter I’m using for my own project.

[ADD SCREENSHOT: main dashboard]

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

- **Invoice History**  
  - Lazy-loaded invoice history component on the billing page.  
  - Shows last 3 invoices by default with "Show more" pagination.  
  - Each invoice displays: invoice number, status badge (paid/open/draft), date, amount, and quick links to view or download PDF.  
  - Automatically refreshes after seat changes or plan switches to show new payments.

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

- **Members Page Components** (for template customization):  
  - `<MembersInviteForm />` - Invite form with seat limit checking, trial conversion, and upgrade flows.  
  - `useTimezone()` - Composable for timezone list and formatting utilities.

- **Organizations & Limits**  
  - First team gets **one free organization**.  
  - Every additional organization requires its own Pro subscription.  
  - Good for “workspace per client” / “workspace per brand” setups.

- **Seats, Members & Invites**  
  - Pro plan is seat-based: base plan includes 1 seat, extra members cost per-seat.  
  - **Owners** can add/remove seats and preview the new price before confirming.  
  - **Admins** can invite members if seats are available, but cannot manage billing. If seats are full, they see a message to contact the team owner.  
  - Invitation links work for both **new** and **existing** users:  
    - If a user signs up from an invite, they land directly in the invited org instead of a confusing default personal team. 
    - If they already have an account, they can click the invite link any time to join the org.

[ADD SCREENSHOT: billing page with downgrade warning + seat controls]

- **Referrals (Users & Orgs)**  
  - Basic tracking hooks for who referred a **user** and/or an **organization** (e.g. for attribution, rewards, or analytics).  
  - Can be extended to payouts or dashboards later.

- **Timezone Switcher**  
  - UI support for choosing a timezone so billing dates, trials, and activity timestamps make sense for the user (not just the server).  
  - Helpful when you have globally distributed teams.

[ADD SCREENSHOT: settings / profile with timezone selector]

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

- **Stripe Billing Sync**  
  - **Organization Name on Invoices**: Stripe customer name is set to the organization name (shows on invoices).  
  - **Auto-sync After Payments**: After subscription creation or updates, customer name is synced back to org name (prevents personal card names from overwriting).  
  - **Org Name Changes**: When organization name is updated in settings, Stripe customer name is automatically updated.  
  - **Owner Email Changes**: When an owner verifies a new email, Stripe customer email is updated for all their organizations.

- **Transactional Emails** (React Email + Resend)  
  - **Account Emails**  
    - **Verify Email**: Sent when a user signs up or changes their email to verify the address.  
    - **Reset Password**: Sent when a user requests to reset their password via forgot password.  
    - **Delete Account**: Sent when a user requests account deletion, requiring email confirmation.  
    - **Team Invite**: Sent when a user is invited to join an organization.  
  - **Billing Emails** (sent to org owner)  
    - **Subscription Confirmed**: Sent when a subscription is created, includes plan, seats, amount, and next billing date.  
    - **Trial Expired**: Sent when a free trial expires without converting to a paid subscription.  
    - **Subscription Canceled**: Sent when a subscription is canceled, includes the date when access ends.  
    - *Coming soon: Trial Expiring, Payment Failed*

- **Auth & Org Handling (Better Auth style)**  
  - Most auth, organization, and subscription flows are implemented the "Better Auth way", using its primitives and conventions.  
  - **Exception:** API keys are wired using metadata on users/orgs to associate keys with organizations where Better Auth doesn't natively handle org-scoped API keys.

[ADD SCREENSHOT: members page showing roles (owner/admin/member)]

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

---

Inspired by the original NuxSaaS project: https://github.com/NuxSaaS/NuxSaaS

### License

MIT. See [LICENSE](LICENSE).

Documentation coming soon – if there’s interest, I’ll prioritize writing deeper docs and examples.
