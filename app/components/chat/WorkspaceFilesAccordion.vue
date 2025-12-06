<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceFilePayload } from '~/server/services/content/workspaceFiles'

const props = defineProps<{
  files: WorkspaceFilePayload[]
}>()

const accordionItems = computed(() => props.files?.map((file) => ({ value: file.id, file })) ?? [])
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs uppercase tracking-wide text-muted-500">
      Files
    </p>
    <UAccordion
      :items="accordionItems"
      type="single"
      collapsible
      :ui="{ root: 'space-y-2' }"
    >
      <template #default="{ item }">
        <div class="flex items-center justify-between gap-3 py-2">
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ item.file.filename }}
            </p>
            <p class="text-xs text-muted-500">
              {{ item.file.sectionsCount }} {{ item.file.sectionsCount === 1 ? 'section' : 'sections' }}
              · {{ item.file.wordCount }} words
            </p>
          </div>
          <UBadge
            size="xs"
            color="neutral"
            variant="soft"
          >
            MDX
          </UBadge>
        </div>
      </template>
      <template #content="{ item }">
        <div class="space-y-3 text-sm">
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Full MDX
          </p>
          <ProsePre
            :code="item.file.fullMdx"
            language="mdx"
            class="text-xs max-h-[500px]"
          >
            {{ item.file.fullMdx }}
          </ProsePre>
        </div>
      </template>
    </UAccordion>
  </div>
</template>
