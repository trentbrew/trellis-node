<template>
  <SplitterPanel
    v-bind="forwarded"
    ref="forwardRef"
    v-slot="{ isCollapsed, isExpanded }: { isCollapsed: boolean; isExpanded: boolean }"
  >
    <slot :is-collapsed="isCollapsed" :is-expanded="isExpanded" />
  </SplitterPanel>
</template>

<script lang="ts" setup>
  import { SplitterPanel, useForwardPropsEmits } from "reka-ui";
  import type { SplitterPanelEmits, SplitterPanelProps } from "reka-ui";

  const props = withDefaults(defineProps<SplitterPanelProps>(), {});

  const forwardRef = ref<InstanceType<typeof SplitterPanel>>();
  const emit = defineEmits<
    SplitterPanelEmits & {
      ready: [value: InstanceType<typeof SplitterPanel>];
    }
  >();

  const forwarded = useForwardPropsEmits(props, emit);

  onMounted(async () => {
    await nextTick();
    emit("ready", forwardRef.value!);
  });
</script>
