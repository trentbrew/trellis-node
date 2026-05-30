<template>
  <div vaul-drawer-wrapper>
    <NuxtRouteAnnouncer />
    <NuxtPwaManifest />
    <NuxtLoadingIndicator color="var(--primary)" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UiSonner />
  </div>
</template>

<script lang="ts" setup>
  const colorMode = useColorMode();

  useSeoMeta({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    keywords: SITE_KEYWORDS.join(", "),
    ogTitle: SITE_TITLE,
    ogDescription: SITE_DESCRIPTION,
    twitterTitle: SITE_TITLE,
    twitterDescription: SITE_DESCRIPTION,
    twitterCard: "summary_large_image",
  });

  useHead({
    htmlAttrs: { lang: "en" },
    link: [{ rel: "icon", type: "image/png", href: "/icon.png" }],
    meta: [
      {
        name: "theme-color",
        content: computed(() =>
          colorMode.value === "dark" ? "#0A0A0A" : "#FAFAF9",
        ),
      },
    ],
  });
</script>
