<template>
  <ComboboxGroup data-slot="autocomplete-group" v-bind="props">
    <slot />
  </ComboboxGroup>
</template>

<script lang="ts" setup>
  import { ComboboxGroup } from "reka-ui";
  import type { ComboboxGroupProps } from "reka-ui";

  const props = defineProps<ComboboxGroupProps>();
</script>
