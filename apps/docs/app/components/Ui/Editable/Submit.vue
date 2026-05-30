<template>
  <EditableSubmitTrigger v-bind="props">
    <slot />
  </EditableSubmitTrigger>
</template>

<script lang="ts" setup>
  import { EditableSubmitTrigger } from "reka-ui";
  import type { EditableSubmitTriggerProps } from "reka-ui";

  const props = defineProps<EditableSubmitTriggerProps>();
</script>
