<template>
  <ListboxGroup data-slot="listbox-group" v-bind="forwarded">
    <slot />
  </ListboxGroup>
</template>

<script lang="ts" setup>
  import { ListboxGroup, useForwardPropsEmits } from "reka-ui";
  import type { ListboxGroupProps } from "reka-ui";

  const props = defineProps<ListboxGroupProps>();
  const forwarded = useForwardPropsEmits(props);
</script>
