<script setup lang="ts">
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'

const { formatDateRelative } = useDate()
const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()

interface ContentEntry {
  id: string
  title: string
  slug: string
  status: string
  updatedAt: Date | null
  contentType: string
  additions?: number
  deletions?: number
  conversationId?: string | null
  bodyMarkdown: string
  frontmatter: Record<string, any> | null
  schemaTypes: string[]
  jsonLd: string | null
  schemaValidation: {
    errors: string[]
    warnings: string[]
  } | null
}

interface ContentApiResponse {
  workspace?: {
    content?: {
      id?: string
      title?: string
      slug?: string
      status?: string
      updatedAt?: string
      contentType?: string
      conversationId?: string | null
    }
    currentVersion?: {
      bodyMdx?: string
      structuredData?: string | null
      diffStats?: {
        additions?: number
        deletions?: number
      }
      frontmatter?: {
        contentType?: string
        diffStats?: {
          additions?: number
          deletions?: number
        }
      } & Record<string, any>
      seoSnapshot?: Record<string, any> | null
    }
  }
}

const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})

const routeSlug = computed(() => {
  const param = route.params.slug
  if (Array.isArray(param))
    return param[0] || null
  if (typeof param === 'string' && param.trim().length > 0 && param !== 't')
    return param
  return null
})

const contentListPath = computed(() => {
  const slug = routeSlug.value
  return slug ? `/${slug}/content` : '/content'
})

// Set workspace header state
const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => null)
const workspaceHeaderLoading = useState<boolean>('workspace/header/loading', () => true)

const setShellHeader = () => {
  workspaceHeader.value = {
    title: 'Loading content…',
    status: null,
    contentType: null,
    updatedAtLabel: null,
    versionId: null,
    additions: 0,
    deletions: 0,
    contentId: contentId.value || undefined,
    showBackButton: true,
    onBack: null,
    onArchive: null,
    onShare: null,
    onPrimaryAction: null,
    primaryActionLabel: '',
    primaryActionColor: '',
    primaryActionDisabled: false
  }
}

setShellHeader()

const { data: contentData, pending, error } = useFetch(() => `/api/content/${contentId.value}`, {
  key: computed(() => `content-${contentId.value}`),
  lazy: true,
  default: () => null
})

const contentEntry = computed<ContentEntry | null>(() => {
  if (!contentData.value)
    return null

  const entry = contentData.value as ContentApiResponse
  const workspace = entry.workspace
  const content = workspace?.content
  const currentVersion = workspace?.currentVersion

  if (!content)
    return null

  let updatedAt: Date | null = null
  if (content?.updatedAt) {
    const parsedDate = new Date(content.updatedAt)
    updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
  }

  const versionStats = currentVersion?.diffStats
  const fmStats = currentVersion?.frontmatter?.diffStats as { additions?: number, deletions?: number } | undefined
  const additions = versionStats?.additions ?? fmStats?.additions ?? 0
  const deletions = versionStats?.deletions ?? fmStats?.deletions ?? 0
  const frontmatter = (currentVersion?.frontmatter as Record<string, any> | undefined) ?? null
  const schemaTypes = Array.isArray(frontmatter?.schemaTypes)
    ? frontmatter.schemaTypes.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  const jsonLd = typeof currentVersion?.structuredData === 'string' ? currentVersion.structuredData : null
  const schemaValidationRaw = currentVersion?.seoSnapshot && typeof currentVersion.seoSnapshot === 'object'
    ? (currentVersion.seoSnapshot as Record<string, any>).schemaValidation
    : null
  const schemaValidation = schemaValidationRaw && typeof schemaValidationRaw === 'object'
    ? {
        errors: Array.isArray(schemaValidationRaw.errors) ? schemaValidationRaw.errors.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        warnings: Array.isArray(schemaValidationRaw.warnings) ? schemaValidationRaw.warnings.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0) : []
      }
    : null

  return {
    id: content?.id || '',
    title: content?.title || 'Untitled content',
    slug: content?.slug || '',
    status: content?.status || 'draft',
    updatedAt,
    contentType: currentVersion?.frontmatter?.contentType || content?.contentType || 'content',
    additions,
    deletions,
    conversationId: content?.conversationId || null,
    bodyMarkdown: currentVersion?.bodyMdx || '',
    frontmatter,
    schemaTypes,
    jsonLd: jsonLd?.trim() || null,
    schemaValidation
  }
})

const frontmatterJson = computed(() => {
  if (!contentEntry.value?.frontmatter) {
    return 'Frontmatter has not been generated yet.'
  }
  try {
    return JSON.stringify(contentEntry.value.frontmatter, null, 2)
  } catch {
    return 'Failed to serialize frontmatter.'
  }
})

const structuredDataSnippet = computed(() => {
  if (contentEntry.value?.jsonLd) {
    return contentEntry.value.jsonLd
  }
  return 'Structured data will be generated automatically once schema types are configured.'
})

const schemaErrors = computed(() => contentEntry.value?.schemaValidation?.errors || [])
const schemaWarnings = computed(() => contentEntry.value?.schemaValidation?.warnings || [])

const isMounted = ref(false)

const setOnBackCallback = () => {
  if (workspaceHeader.value) {
    workspaceHeader.value.onBack = () => {
      router.push(localePath(contentListPath.value))
    }
  }
}

onMounted(() => {
  isMounted.value = true
  setOnBackCallback()
})

watch(contentEntry, (entry) => {
  if (entry) {
    const updatedAtLabel = formatDateRelative(entry.updatedAt, { includeTime: true })

    workspaceHeader.value = {
      title: entry.title,
      status: entry.status,
      contentType: entry.contentType,
      updatedAtLabel,
      versionId: null,
      additions: entry.additions ?? 0,
      deletions: entry.deletions ?? 0,
      contentId: entry.id,
      showBackButton: true,
      onBack: null,
      onArchive: null,
      onShare: null,
      onPrimaryAction: null,
      primaryActionLabel: '',
      primaryActionColor: '',
      primaryActionDisabled: false
    }

    if (isMounted.value) {
      setOnBackCallback()
    }

    workspaceHeaderLoading.value = false
  }
}, { immediate: true })

watchEffect(() => {
  if (!contentEntry.value) {
    workspaceHeaderLoading.value = pending.value
  }
})
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="pending"
      class="space-y-4"
    >
      <USkeleton class="h-20 w-full" />
      <USkeleton class="h-32 w-3/4" />
      <USkeleton class="h-24 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="error.message || 'Failed to load content'"
    />

    <template v-else-if="contentEntry">
      <div class="space-y-4 mb-4">
        <UAlert
          v-if="schemaErrors.length"
          color="error"
          variant="soft"
          icon="i-lucide-alert-circle"
          title="Schema requirements missing"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 text-sm">
              <li
                v-for="issue in schemaErrors"
                :key="`schema-error-${issue}`"
              >
                {{ issue }}
              </li>
            </ul>
          </template>
        </UAlert>
        <UAlert
          v-if="schemaWarnings.length"
          color="warning"
          variant="soft"
          icon="i-lucide-alert-triangle"
          title="Schema improvements suggested"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 text-sm">
              <li
                v-for="issue in schemaWarnings"
                :key="`schema-warning-${issue}`"
              >
                {{ issue }}
              </li>
            </ul>
          </template>
        </UAlert>
      </div>

      <UCard class="mb-4">
        <template #header>
          <p class="text-sm font-medium">
            Content details
          </p>
        </template>
        <div class="space-y-4">
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Slug
            </p>
            <p class="font-medium break-all">
              {{ contentEntry.slug || '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Status
            </p>
            <p class="font-medium capitalize">
              {{ contentEntry.status }}
            </p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Content type
            </p>
            <p class="font-medium capitalize">
              {{ contentEntry.contentType }}
            </p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Schema types
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <template v-if="contentEntry.schemaTypes.length">
                <UBadge
                  v-for="schema in contentEntry.schemaTypes"
                  :key="schema"
                  size="xs"
                  color="neutral"
                  variant="soft"
                >
                  {{ schema }}
                </UBadge>
              </template>
              <span
                v-else
                class="text-sm text-muted-500"
              >
                Not set
              </span>
            </div>
          </div>
        </div>
      </UCard>

      <UCard class="mb-4">
        <template #header>
          <p class="text-sm font-medium">
            Body Markdown
          </p>
        </template>
        <UTextarea
          :model-value="contentEntry.bodyMarkdown || ''"
          placeholder="No content available"
          readonly
          :rows="20"
          autoresize
          class="w-full"
        />
      </UCard>

      <UCard class="mb-4">
        <template #header>
          <p class="text-sm font-medium">
            Frontmatter
          </p>
        </template>
        <UTextarea
          :model-value="frontmatterJson"
          readonly
          :rows="12"
          autoresize
          class="w-full"
        />
      </UCard>

      <UCard>
        <template #header>
          <p class="text-sm font-medium">
            JSON-LD Structured Data
          </p>
        </template>
        <UTextarea
          :model-value="structuredDataSnippet"
          readonly
          :rows="12"
          autoresize
          class="w-full"
        />
      </UCard>
    </template>

    <UAlert
      v-else
      color="neutral"
      variant="soft"
      icon="i-lucide-file-text"
      title="No content available"
      description="This content item could not be found or loaded."
    />
  </div>
</template>
