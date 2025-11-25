// ============================================
// ROLE DEFINITIONS
// ============================================
export type OrgRole = 'owner' | 'admin' | 'member'

// ============================================
// SUBSCRIPTION PLANS & LIMITS
// ============================================
export type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'incomplete' | 'past_due' | null

export interface PlanLimits {
  maxOrganizations?: number
  maxMembers?: number
  maxProjects?: number
  maxStorage?: number
  // Add more limits as needed
}

export const PLAN_LIMITS = {
  FREE: {
    maxOrganizations: 1, // Only 1 free org allowed per user
    maxMembers: 1,
    maxProjects: 3,
    maxStorage: 1 // GB
  },
  PRO: {
    // Note: Each additional organization requires its own Pro subscription
    // This is a per-organization limit, not a user-wide limit
    maxMembers: Infinity,
    maxProjects: Infinity,
    maxStorage: 100 // GB
  }
} as const

/**
 * Check if user has an active Pro subscription
 */
export function hasProSubscription(
  status: SubscriptionStatus
): boolean {
  return status === 'active' || status === 'trialing'
}

/**
 * Get plan limits based on subscription status
 */
export function getPlanLimits(
  status: SubscriptionStatus
): PlanLimits {
  return hasProSubscription(status) ? PLAN_LIMITS.PRO : PLAN_LIMITS.FREE
}

/**
 * Check if feature is available based on subscription
 * Note: Each organization requires its own Pro subscription.
 * This checks features within a single organization.
 */
export function canAccessFeature(
  status: SubscriptionStatus,
  feature: 'multipleMembers' | 'unlimitedProjects'
): boolean {
  const isPro = hasProSubscription(status)

  switch (feature) {
    case 'multipleMembers':
      return isPro
    case 'unlimitedProjects':
      return isPro
    default:
      return false
  }
}

// ============================================
// ROUTE PERMISSIONS
// ============================================
// Routes that are always accessible, even for unpaid 2nd+ orgs
export const UNRESTRICTED_ROUTES = [
  '/billing',
  '/settings' // Allow access to settings so users can delete their org
]

// Check if a route path is unrestricted
export function isUnrestrictedRoute(path: string): boolean {
  return UNRESTRICTED_ROUTES.some(route => path.includes(route))
}

// ============================================
// ORGANIZATION PERMISSIONS
// ============================================
export const PERMISSIONS = {
  // Member Management
  INVITE_MEMBERS: ['owner', 'admin'],
  REMOVE_MEMBERS: ['owner', 'admin'],
  CHANGE_MEMBER_ROLE: ['owner', 'admin'],
  VIEW_MEMBERS: ['owner', 'admin', 'member'],

  // Organization Settings
  UPDATE_ORG_SETTINGS: ['owner', 'admin'],
  DELETE_ORGANIZATION: ['owner'],
  VIEW_ORG_SETTINGS: ['owner', 'admin'],

  // Billing
  MANAGE_BILLING: ['owner'],
  VIEW_BILLING: ['owner'],

  // Invitations
  CANCEL_INVITATION: ['owner', 'admin'],
  RESEND_INVITATION: ['owner', 'admin'],

  // Navigation Visibility
  VIEW_BILLING_NAV: ['owner'], // Only owners see billing in nav
  VIEW_SETTINGS_NAV: ['owner', 'admin'], // Owners and admins see settings
  VIEW_MEMBERS_NAV: ['owner', 'admin', 'member'], // Everyone sees members
  VIEW_DASHBOARD_NAV: ['owner', 'admin', 'member'] // Everyone sees dashboard
} as const

// ============================================
// PERMISSION CHECKER FUNCTIONS
// ============================================

/**
 * Check if a role has a specific permission
 */
export function hasPermission(
  userRole: OrgRole | null | undefined,
  permission: keyof typeof PERMISSIONS
): boolean {
  if (!userRole)
    return false
  return (PERMISSIONS[permission] as readonly OrgRole[]).includes(userRole)
}

/**
 * Check if user can manage members (invite, remove, change roles)
 */
export function canManageMembers(role: OrgRole | null | undefined): boolean {
  return hasPermission(role, 'INVITE_MEMBERS')
}

/**
 * Check if user can manage billing
 */
export function canManageBilling(role: OrgRole | null | undefined): boolean {
  return hasPermission(role, 'MANAGE_BILLING')
}

/**
 * Check if user can update organization settings
 */
export function canUpdateOrgSettings(role: OrgRole | null | undefined): boolean {
  return hasPermission(role, 'UPDATE_ORG_SETTINGS')
}

/**
 * Check if user can delete organization
 */
export function canDeleteOrganization(role: OrgRole | null | undefined): boolean {
  return hasPermission(role, 'DELETE_ORGANIZATION')
}

/**
 * Check if user is owner
 */
export function isOwner(role: OrgRole | null | undefined): boolean {
  return role === 'owner'
}

/**
 * Check if user is admin or owner
 */
export function isAdminOrOwner(role: OrgRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
