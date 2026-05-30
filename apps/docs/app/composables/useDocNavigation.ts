import { kebabCase } from "lodash-es";

export const useDocNavigation = async () => {
  const route = useRoute();
  const { data } = await useAsyncData(kebabCase(route.path) + "-navigation", async () => {
    const content = await queryCollectionNavigation("content", [
      "icon",
      "label",
      "links",
      "layout",
    ]);
    return { content };
  });
  return { content: data.value?.content };
};
