import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { createAppContainer } from './lib/bootstrap.js';

// Composition root: the app-wide DI container is built here and handed to the
// root component, which publishes it to the tree via Svelte context.
const container = createAppContainer();

const app = mount(App, {
  target: document.getElementById('app'),
  props: { container },
});

export default app;
