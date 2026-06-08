export const FRAMEWORK = (() => {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  if (path.includes('/vue')) return 'Vue';
  if (path.includes('/svelte')) return 'Svelte';
  return 'React';
})();

export const FRAMEWORK_LINKS = [
  { label: 'React', href: '/react/' },
  { label: 'Vue', href: '/vue/' },
  { label: 'Svelte', href: '/svelte/' },
] as const;
