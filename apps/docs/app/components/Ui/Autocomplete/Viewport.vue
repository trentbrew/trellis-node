<template>
  <ComboboxViewport data-slot="autocomplete-viewport" v-bind="props">
    <slot />
  </ComboboxViewport>
</template>

<script lang="ts" setup>
  import { ComboboxViewport } from "reka-ui";
  import type { ComboboxViewportProps } from "reka-ui";

  const props = defineProps<ComboboxViewportProps>();
</script>
