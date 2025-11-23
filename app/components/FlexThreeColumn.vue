<template>
  <div class="flex items-center justify-between flex-1 gap-x-1.5">
    <slot>
      <div class="flex items-center gap-1.5">
        <slot name="left" />
      </div>
      <div class="flex items-center gap-1.5">
        <slot name="middle" />
      </div>
      <div class="flex items-center gap-1.5">
        <slot name="right" />
      </div>
    </slot>
  </div>
</template>
