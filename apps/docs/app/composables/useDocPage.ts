import { kebabCase } from "lodash-es";

export const useDocPage = async () => {
  const route = useRoute();
  const { data } = await useAsyncData(kebabCase(route.path) + "-page", async () => {
    const content = await queryCollection("content").path(route.path).first();
    return { content };
  });
  return { contentPage: data.value?.content };
};
