<script setup lang="ts">
const { userId, t } = defineProps<{
  userId: string
  t: TranFunction
}>()

const emit = defineEmits<{
  banned: []
  cancel: []
}>()

const open = defineModel('open', { default: false })

const state = reactive({
  banReason: '',
  banExpiresIn: -1 as number | undefined
})

const schema = z.object({
  banReason: z.string().optional(),
  banExpiresIn: z.number().optional()
})
type Schema = zodOutput<typeof schema>

const { client } = useAuth()

const banPeriods = [
  { value: -1, label: 'permanent' },
  { value: 60 * 60 * 24, label: '1_day' },
  { value: 60 * 60 * 24 * 7, label: '7_days' },
  { value: 60 * 60 * 24 * 30, label: '30_days' }
].map((item) => {
  return {
    ...item,
    label: t(`user.modals.ban.periods.${item.label}`)
  }
})

async function onSubmit({ data }: FormSubmitEvent<Schema>) {
  const result = await client.admin.banUser({
    userId,
    banReason: data.banReason,
    banExpiresIn: data.banExpiresIn == -1 ? undefined : data.banExpiresIn
  })
  if (result.data?.user) {
    open.value = false
    emit('banned')
  }
}

const onCancel = () => {
  open.value = false
  emit('cancel')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :close="true"
    :title="t('user.modals.ban.title')"
  >
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          :label="t('user.modals.ban.period')"
          name="banExpiresIn"
        >
          <USelect
            v-model="state.banExpiresIn"
            :items="banPeriods"
            class="w-full"
          />
        </UFormField>
        <UFormField
          :label="t('user.modals.ban.reason')"
          name="banReason"
        >
          <UTextarea
            v-model="state.banReason"
            :placeholder="t('user.modals.ban.reasonPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="outline"
            @click="onCancel"
          >
            {{ t('global.page.cancel') }}
          </UButton>
          <UButton
            type="submit"
            color="error"
          >
            {{ t('user.modals.ban.submit') }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
