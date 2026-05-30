<template>
  <EditableEditTrigger v-bind="props">
    <slot />
  </EditableEditTrigger>
</template>

<script lang="ts" setup>
  import { EditableEditTrigger } from "reka-ui";
  import type { EditableEditTriggerProps } from "reka-ui";

  const props = defineProps<EditableEditTriggerProps>();
</script>
