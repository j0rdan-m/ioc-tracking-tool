<script>
  /** @type {{ value?: string }} */
  let { value = $bindable('') } = $props();
</script>

<div class="search">
  <svg
    class="search__icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4.2-4.2" stroke-linecap="round" />
  </svg>
  <input
    class="search__input"
    type="search"
    placeholder="Search by name, description, tag or URL…"
    aria-label="Search tools"
    bind:value
  />
</div>

<style>
  .search {
    position: relative;
    flex: 1 1 18rem;
    max-width: 26rem;
  }

  .search__icon {
    position: absolute;
    top: 50%;
    left: 0.9rem;
    width: 1rem;
    height: 1rem;
    transform: translateY(-50%);
    color: var(--color-text-muted);
    pointer-events: none;
  }

  .search__input {
    width: 100%;
    padding: var(--space-2) var(--space-4) var(--space-2) var(--space-8);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-pill);
    transition: var(--transition-field);
  }

  .search__input::placeholder {
    color: var(--color-text-muted);
  }

  .search__input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
  }
</style>
