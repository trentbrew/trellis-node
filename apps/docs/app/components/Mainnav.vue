<template>
  <header class="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur">
    <div class="flex h-14 w-full items-center justify-between px-4 lg:px-6">
      <div class="flex items-center gap-10">
        <div class="flex items-center gap-3">
          <UiButton
            size="icon-xs"
            variant="outline"
            class="lg:hidden"
            @click="mobileNavState = true"
            ><Icon name="heroicons:bars-2" class="size-4" />
          </UiButton>
          <NuxtLink to="/" class="flex items-center gap-2 text-lg font-bold tracking-tight">
            <img src="/logo.svg" alt="Trellis" class="size-5 invert dark:invert-0" />
            <span>trellis</span>
          </NuxtLink>
        </div>
        <nav class="hidden items-center space-x-6 text-sm font-medium lg:flex">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :class="[link.isActive(route.path) ? 'text-foreground!' : '']"
            :to="link.to"
            class="text-foreground/50 transition-colors hover:text-foreground"
            >{{ link.label }}</NuxtLink
          >
        </nav>
      </div>

      <div class="flex items-center">
        <UiButton
          size="sm"
          class="mr-2 hidden min-w-[260px] font-normal text-muted-foreground md:flex"
          variant="outline"
          @click="isOpen = true"
        >
          <Icon name="lucide:search" />
          Search docs...
          <ClientOnly>
            <template #fallback>
              <UiKbd class="ml-auto"> K</UiKbd>
            </template>
            <UiKbd class="ml-auto">{{ metaSymbol }}+K</UiKbd>
          </ClientOnly>
        </UiButton>
        <UiButton size="icon-sm" class="md:hidden" variant="ghost" @click="isOpen = true">
          <Icon name="lucide:search" class="h-[18px] w-[18px]" />
        </UiButton>
        <UiButton
          to="https://www.npmjs.com/package/trellis"
          target="_blank"
          variant="ghost"
          size="icon-sm"
          ><Icon name="simple-icons:npm" class="h-[18px] w-[18px]"
        /></UiButton>
        <UiButton
          to="https://github.com/trentbrew/trellis"
          target="_blank"
          variant="ghost"
          size="icon-sm"
          ><Icon name="radix-icons:github-logo" class="h-[18px] w-[18px]"
        /></UiButton>
        <CommandSearch v-model="isOpen" />
        <UiDropdownMenu>
          <UiDropdownMenuTrigger as-child>
            <UiButton variant="ghost" size="icon-sm">
              <ClientOnly>
                <template #fallback>
                  <Icon :name="'lucide:sun'" />
                </template>
                <Icon v-if="currentIcon" :name="currentIcon" />
              </ClientOnly>
            </UiButton>
          </UiDropdownMenuTrigger>
          <UiDropdownMenuContent align="end" :side-offset="5">
            <UiDropdownMenuItem
              v-for="(m, i) in modes"
              :key="i"
              class="cursor-pointer"
              :icon="m.icon"
              :title="m.title"
              @click="setTheme(m.value)"
            />
          </UiDropdownMenuContent>
        </UiDropdownMenu>
      </div>
    </div>
    <MobileNav />
  </header>
</template>

<script lang="ts" setup>
  const modes = [
    { icon: "lucide:sun", title: "Light", value: "light" },
    { icon: "lucide:moon", title: "Dark", value: "dark" },
    { icon: "lucide:laptop", title: "System", value: "system" },
  ];

  const navLinks = [
    {
      label: "Docs",
      to: "/getting-started/introduction",
      isActive: (path: string) =>
        path.startsWith("/getting-started/") || path.startsWith("/guides/"),
    },
    {
      label: "Vision",
      to: "/vision/local-first-os",
      isActive: (path: string) => path.startsWith("/vision/"),
    },
    {
      label: "Architecture",
      to: "/architecture/runtime",
      isActive: (path: string) => path.startsWith("/architecture/"),
    },
    {
      label: "Protocol",
      to: "/protocol/overview",
      isActive: (path: string) => path.startsWith("/protocol/"),
    },
    {
      label: "Roadmap",
      to: "/roadmap/current",
      isActive: (path: string) => path.startsWith("/roadmap/"),
    },
  ];

  const route = useRoute();

  const mobileNavState = useMobileNavState();

  const colorMode = useColorMode();
  const setTheme = (val: string) => {
    colorMode.preference = val;
  };

  const currentIcon = computed(() => {
    return modes.find((m) => m.value === colorMode?.preference)?.icon;
  });

  const isOpen = ref(false);

  const { getKbdKey } = useKbd();
  const metaSymbol = computed(() => getKbdKey("meta"));

  defineShortcuts({
    meta_k: () => {
      isOpen.value = !isOpen.value;
    },
  });
</script>
