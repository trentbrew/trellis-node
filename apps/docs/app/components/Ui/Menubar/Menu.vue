<template>
  <MenubarMenu data-slot="menubar-menu" v-bind="props">
    <slot />
  </MenubarMenu>
</template>

<script lang="ts" setup>
  import { MenubarMenu } from "reka-ui";
  import type { MenubarMenuProps } from "reka-ui";

  const props = defineProps<MenubarMenuProps>();
</script>
