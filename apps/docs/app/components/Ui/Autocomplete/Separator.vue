<template>
  <ComboboxSeparator data-slot="autocomplete-separator" v-bind="props">
    <slot />
  </ComboboxSeparator>
</template>

<script lang="ts" setup>
  import { ComboboxSeparator } from "reka-ui";
  import type { ComboboxSeparatorProps } from "reka-ui";

  const props = defineProps<ComboboxSeparatorProps>();
</script>
