<script>
  /** @type {{ raw?: import('../types.js').ProviderRawResponse | null }} */
  let { raw = null } = $props();

  /** @param {number} bytes */
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
</script>

{#if raw}
  <details class="raw-response">
    <summary>
      Raw response · HTTP {raw.status} · {formatBytes(raw.storedBytes)}{raw.truncated ? ' · truncated' : ''}
    </summary>
    <dl>
      <div><dt>Provider URL</dt><dd><code>{raw.url}</code></dd></div>
      <div><dt>Content type</dt><dd>{raw.contentType ?? 'Not exposed by CORS'}</dd></div>
      <div><dt>Original size</dt><dd>{formatBytes(raw.originalBytes)}</dd></div>
    </dl>
    {#if raw.truncated}
      <p>This response exceeded the local retention limit; only the inert text prefix is shown.</p>
    {/if}
    <pre>{raw.body}</pre>
  </details>
{/if}

<style>
  .raw-response {
    min-width: 0;
    padding: var(--space-2);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  summary {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    cursor: pointer;
  }

  dl {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-3) 0;
  }

  dl div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  dt,
  p {
    color: var(--color-text-muted);
    font-size: var(--font-size-2xs);
  }

  dd,
  p {
    margin: 0;
  }

  code {
    color: var(--color-text);
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  pre {
    max-height: 18rem;
    margin: var(--space-3) 0 0;
    padding: var(--space-3);
    overflow: auto;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
