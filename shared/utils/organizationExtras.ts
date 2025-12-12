export interface OwnershipInfo {
  ownedCount: number
  firstOwnedOrgId: string | null
}

export interface ActiveOrgExtras<TSub = any> {
  subscriptions: TSub[]
  needsUpgrade: boolean
  userOwnsMultipleOrgs: boolean
}

export const createEmptyActiveOrgExtras = <TSub = any>(): ActiveOrgExtras<TSub> => ({
  subscriptions: [],
  needsUpgrade: false,
  userOwnsMultipleOrgs: false
})

export const computeUserOwnsMultipleOrgs = (info?: OwnershipInfo | null) => Boolean(info && info.ownedCount > 1)

export const computeNeedsUpgrade = (organizationId: string | undefined, subs: any[], info?: OwnershipInfo | null) => {
  const hasActiveSub = Array.isArray(subs) && subs.some(sub => sub?.status === 'active' || sub?.status === 'trialing')
  if (!organizationId)
    return false
  if (!info)
    return !hasActiveSub
  return !hasActiveSub && info.firstOwnedOrgId !== organizationId
}
