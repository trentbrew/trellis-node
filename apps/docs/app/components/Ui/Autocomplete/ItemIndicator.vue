<template>
  <ComboboxItemIndicator data-slot="autocomplete-item-indicator" v-bind="props">
    <slot><Icon :name="icon || 'lucide:check'" class="size-4" /></slot>
  </ComboboxItemIndicator>
</template>

<script lang="ts" setup>
  import { ComboboxItemIndicator } from "reka-ui";
  import type { ComboboxItemIndicatorProps } from "reka-ui";

  const props = defineProps<
    ComboboxItemIndicatorProps & {
      icon?: string;
    }
  >();
</script>
