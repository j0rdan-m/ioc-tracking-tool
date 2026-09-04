import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Svelte compiler options — consumed by svelte-check and the vite plugin.
// Kept minimal: no preprocessor language (TS, SCSS…) is used in components.
export default {
  preprocess: vitePreprocess(),
};
