export interface WorkspaceHeaderState {
  title: string
  contentType?: string | null
  updatedAtLabel?: string | null
  versionId?: string | null
  additions: number
  deletions: number
  showBackButton: boolean
  onBack?: (() => void) | null
  onArchive?: (() => void) | null
  onShare?: (() => void) | null
  onPrimaryAction?: (() => void) | null
  primaryActionLabel: string
  primaryActionColor: string
  primaryActionDisabled: boolean
}
