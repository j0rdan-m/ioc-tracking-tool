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
    padding: 0.55rem 1rem 0.55rem 2.5rem;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .search__input::placeholder {
    color: var(--color-text-muted);
  }

  .search__input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px rgb(56 189 248 / 0.18);
  }
</style>
