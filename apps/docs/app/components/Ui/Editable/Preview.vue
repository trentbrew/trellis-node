<template>
  <EditablePreview v-bind="props">
    <slot />
  </EditablePreview>
</template>

<script lang="ts" setup>
  import { EditablePreview } from "reka-ui";
  import type { EditablePreviewProps } from "reka-ui";

  const props = defineProps<EditablePreviewProps>();
</script>
