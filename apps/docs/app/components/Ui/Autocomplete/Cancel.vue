<template>
  <ComboboxCancel data-slot="autocomplete-cancel" v-bind="props">
    <slot />
  </ComboboxCancel>
</template>

<script lang="ts" setup>
  import { ComboboxCancel } from "reka-ui";
  import type { ComboboxCancelProps } from "reka-ui";

  const props = defineProps<ComboboxCancelProps>();
</script>
