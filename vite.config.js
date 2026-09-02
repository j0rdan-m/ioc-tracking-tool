import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// GitHub Pages serves project sites from a subpath (https://<user>.github.io/<repo>/),
// so the base must match, otherwise built assets would 404. Set to '/' when using
// a custom domain instead.
export default defineConfig({
  base: '/ioc-tracking-tool/',
  plugins: [svelte()],
});

