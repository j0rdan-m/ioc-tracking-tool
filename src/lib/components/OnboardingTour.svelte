<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import {
    TOUR_VERSIONS,
    computeTourLayout,
    getStep,
    isFirstStep,
    isLastStep,
    nextIndex,
    prevIndex,
    stepProgress,
  } from '../utils/onboarding-tour.js';

  /**
   * First-visit onboarding tour: a spotlight overlay walking through the real
   * controls of one context. The same component drives every tour (page
   * toolbar, Extract IoCs modal, investigation workspace): it receives the step
   * list and the `scope` key under which its completion is stored, and can be
   * replayed any time by the owner (App, the modal, the workspace).
   *
   * The component only measures the DOM and applies what the pure helpers return,
   * so the step lists, the navigation and the placement geometry stay testable
   * in `npm run smoke`.
   *
   * @type {{ open?: boolean, steps: readonly import('../utils/onboarding-tour.js').TourStep[],
   *           scope: import('../utils/onboarding-tour.js').TourScope }}
   */
  let { open = $bindable(false), steps, scope } = $props();

  /** @type {import('../services/onboarding.js').OnboardingService} */
  const onboarding = inject(DI_TOKENS.onboarding);

  let index = $state(0);
  /** @type {import('../utils/onboarding-tour.js').TargetRect | null} */
  let targetRect = $state(null);
  let viewport = $state({ width: 0, height: 0 });
  let cardSize = $state({ width: 0, height: 0 });
  /** @type {HTMLDivElement | undefined} */
  let card = $state();

  // Per-scope ids: several tours can be mounted in the same page.
  const titleId = $derived(`tour-title-${scope}`);

  const step = $derived(getStep(index, steps));
  const first = $derived(isFirstStep(index, steps.length));
  const last = $derived(isLastStep(index, steps.length));
  const progress = $derived(stepProgress(index, steps.length));
  const layout = $derived(
    computeTourLayout(targetRect, viewport, cardSize, { offset: 16, margin: 16 }),
  );

  // Measuring is the only DOM work: the target is found by its `data-tour`
  // attribute and re-read whenever the step changes or the page scrolls/resizes.
  $effect(() => {
    if (!open) {
      targetRect = null;
      return;
    }
    const stepTarget = step?.target;
    const measure = () => {
      const element = stepTarget ? document.querySelector(`[data-tour="${stepTarget}"]`) : null;
      if (!element) {
        targetRect = null;
      } else {
        const box = element.getBoundingClientRect();
        targetRect =
          box.width > 0 && box.height > 0
            ? { top: box.top, left: box.left, width: box.width, height: box.height }
            : null;
      }
      viewport = { width: window.innerWidth, height: window.innerHeight };
    };
    measure();

    let frame = 0;
    /** Coalesce bursts of events into one measurement per animation frame. */
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    // The toolbar only exists once the catalog resolves, so a target can appear
    // after the tour opened: re-measure when nodes are added. Only `childList`
    // is watched — watching attributes would re-trigger on our own inline styles.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer.disconnect();
    };
  });

  // Reopening the tour (Guide button) always starts from the first step, and the
  // card takes the focus so the keyboard shortcuts work without a click.
  $effect(() => {
    if (open) {
      index = 0;
      card?.focus();
    }
  });

  function finish() {
    open = false;
    onboarding.markSeen(scope, TOUR_VERSIONS[scope]);
  }

  function goNext() {
    if (isLastStep(index, steps.length)) {
      finish();
      return;
    }
    index = nextIndex(index, steps.length);
  }

  function goPrevious() {
    index = prevIndex(index, steps.length);
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrevious();
    }
  }
</script>

{#if open && step}
  <div
    class="tour"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <!-- Full-screen veil: the highlighted control stays visible through the
         cut-out, everything else is dimmed. The veil also captures the clicks,
         so the tour never triggers a control by accident. -->
    <div class="tour__veil" class:tour__veil--spotlight={layout.spotlight.visible}>
      {#if layout.spotlight.visible}
        <div
          class="tour__cutout"
          style:top="{layout.spotlight.top}px"
          style:left="{layout.spotlight.left}px"
          style:width="{layout.spotlight.width}px"
          style:height="{layout.spotlight.height}px"
          aria-hidden="true"
        ></div>
      {/if}
    </div>

    <div
      class="tour__card"
      bind:this={card}
      bind:clientWidth={cardSize.width}
      bind:clientHeight={cardSize.height}
      style:top="{layout.card.top}px"
      style:left="{layout.card.left}px"
      tabindex="-1"
    >
      <div class="tour__head">
        <p class="tour__eyebrow">{step.eyebrow}</p>
        <button type="button" class="tour__close" onclick={finish} aria-label="Skip the tour">
          ✕
        </button>
      </div>

      <h2 class="tour__title" id={titleId}>{step.title}</h2>
      <p class="tour__body" aria-live="polite">{step.body}</p>

      <div class="tour__progress">
        <div
          class="tour__progress-fill"
          style:width="{progress.percent}%"
          role="progressbar"
          aria-valuenow={progress.current}
          aria-valuemin="1"
          aria-valuemax={progress.total}
          aria-label="Tour progress"
        ></div>
      </div>

      <footer class="tour__foot">
        <p class="tour__counter">{progress.current} / {progress.total}</p>
        <div class="tour__actions">
          <button type="button" class="tour__skip" onclick={finish}>Skip</button>
          {#if !first}
            <button type="button" class="tour__back" onclick={goPrevious}>Back</button>
          {/if}
          <button type="button" class="tour__next" onclick={goNext}>
            {last ? 'Start investigating' : 'Next'}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: var(--z-tour);
  }

  .tour__veil {
    position: absolute;
    inset: 0;
    z-index: var(--z-modal-content);
    background: var(--tour-veil);
  }

  /* When a control is highlighted the cut-out carries the veil instead, so the
     control itself stays visible through the hole. */
  .tour__veil--spotlight {
    background: transparent;
  }

  /* The cut-out punches a transparent window through the veil, with an accent
     ring so the analyst never loses track of the highlighted control. */
  .tour__cutout {
    position: fixed;
    border-radius: var(--tour-spotlight-radius);
    box-shadow: var(--tour-target-halo);
    pointer-events: none;
  }

  .tour__card {
    position: fixed;
    z-index: var(--z-tour-card);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(var(--tour-card-width), calc(100% - 2 * var(--space-5)));
    max-height: calc(100% - 2 * var(--space-5));
    overflow-y: auto;
    padding: var(--modal-padding);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
  }

  .tour__card:focus {
    outline: none;
  }

  .tour__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .tour__eyebrow {
    margin: 0;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-wide);
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .tour__close {
    padding: 0;
    font: inherit;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .tour__close:hover {
    color: var(--color-text);
  }

  .tour__title {
    margin: 0;
    font-size: var(--font-size-lg);
    line-height: var(--line-height-heading);
    color: var(--color-hero-title);
  }

  .tour__body {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: var(--line-height-body);
    color: var(--color-text-muted);
  }

  .tour__progress {
    height: var(--tour-progress-height);
    overflow: hidden;
    background: var(--color-neutral-track);
    border-radius: var(--radius-pill);
  }

  .tour__progress-fill {
    height: 100%;
    background: var(--color-accent);
    transition: var(--transition-width);
  }

  .tour__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .tour__counter {
    margin: 0;
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }

  .tour__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .tour__skip,
  .tour__back,
  .tour__next {
    padding: var(--space-2) var(--space-5);
    font: inherit;
    font-weight: var(--font-weight-semibold);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .tour__skip,
  .tour__back {
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
  }

  .tour__skip:hover,
  .tour__back:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .tour__next {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: none;
  }

  .tour__next:hover {
    background: var(--color-accent-strong);
  }
</style>

