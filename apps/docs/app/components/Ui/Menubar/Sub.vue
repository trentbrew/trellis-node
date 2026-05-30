<template>
  <MenubarSub data-slot="menubar-sub" v-bind="forwarded">
    <slot />
  </MenubarSub>
</template>

<script lang="ts" setup>
  import { MenubarSub, useForwardPropsEmits } from "reka-ui";
  import type { MenubarSubEmits, MenubarSubProps } from "reka-ui";

  const props = defineProps<MenubarSubProps>();
  const emits = defineEmits<MenubarSubEmits>();
  const forwarded = useForwardPropsEmits(props, emits);
</script>
