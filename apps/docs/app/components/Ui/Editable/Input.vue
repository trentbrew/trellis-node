<template>
  <EditableInput v-bind="props">
    <slot />
  </EditableInput>
</template>

<script lang="ts" setup>
  import { EditableInput } from "reka-ui";
  import type { EditableInputProps } from "reka-ui";

  const props = defineProps<EditableInputProps>();
</script>
