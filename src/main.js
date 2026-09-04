import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { createAppContainer } from './lib/bootstrap.js';

// Composition root: the app-wide DI container is built here and handed to the
// root component, which publishes it to the tree via Svelte context.
const container = createAppContainer();

const target = document.getElementById('app');
if (!target) {
  throw new Error('main: no #app element to mount into.');
}

const app = mount(App, {
  target,
  props: { container },
});

export default app;
