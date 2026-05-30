<template>
  <EditableArea v-bind="props">
    <slot />
  </EditableArea>
</template>

<script lang="ts" setup>
  import { EditableArea } from "reka-ui";
  import type { EditableAreaProps } from "reka-ui";

  const props = defineProps<EditableAreaProps>();
</script>
