<template>
  <MenubarRadioGroup data-slot="menubar-radio-group" v-bind="forwarded">
    <slot />
  </MenubarRadioGroup>
</template>

<script lang="ts" setup>
  import { MenubarRadioGroup, useForwardPropsEmits } from "reka-ui";
  import type { MenubarRadioGroupEmits, MenubarRadioGroupProps } from "reka-ui";

  const props = defineProps<MenubarRadioGroupProps>();
  const emits = defineEmits<MenubarRadioGroupEmits>();
  const forwarded = useForwardPropsEmits(props, emits);
</script>
