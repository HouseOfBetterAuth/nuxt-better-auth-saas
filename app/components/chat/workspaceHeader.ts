export interface WorkspaceHeaderState {
  title: string
  status?: string | null
  contentType?: string | null
  updatedAtLabel?: string | null
  versionId?: string | null
  contentId?: string | null
  additions: number
  deletions: number
  tabs?: {
    items: Array<{ label: string, value: string }>
    modelValue: string
    onUpdate?: (value: string) => void
  } | null
  showBackButton: boolean
  onBack?: (() => void) | null
  onArchive?: (() => void) | null
  onShare?: (() => void) | null
  onPrimaryAction?: (() => void) | null
  primaryActionLabel: string
  primaryActionColor: string
  primaryActionDisabled: boolean
}
