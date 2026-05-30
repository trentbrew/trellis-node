<template>
  <div
    class="size-full bg-zinc-950"
  >
    <div class="flex size-full flex-col items-center justify-center">
      <div
        class="mb-10 inline-flex items-center gap-2 rounded-full border border-solid border-zinc-700/50 px-4 py-2 text-center text-2xl font-bold text-white"
      >
        Trellis
      </div>
      <h1 class="mb-10 text-center text-7xl font-bold tracking-tight text-white capitalize">
        {{ title }}
      </h1>
      <p class="mx-auto max-w-5xl text-center text-4xl leading-[1.8] text-white">
        {{ description }}
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
  defineOptions({ inheritAttrs: false });
  defineProps<{
    title?: string;
    description?: string;
  }>();
</script>
