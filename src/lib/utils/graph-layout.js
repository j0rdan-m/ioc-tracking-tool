/**
 * Deterministic graph layout for the V2 workspace (US V2 "Graph layout"):
 * automatic placement by depth — seeds on an inner ring, each further hop on a
 * wider ring, scaled to stay inside the canvas — with manually dragged
 * positions ALWAYS winning (V2 AC17).
 *
 * Pure module: no DOM, no network, no Svelte — exercised by `npm run smoke`.
 *
 * @typedef {import('../types.js').WorkspaceNode} WorkspaceNode
 * @typedef {{ x: number, y: number }} Point
 */

/** Base world coordinates of the SVG canvas (viewBox units). */
export const GRAPH_WIDTH = 900;
export const GRAPH_HEIGHT = 620;

const SEED_RADIUS = 120;
const RING_GAP = 140;
const EDGE_MARGIN = 48;

/** @param {number} value @returns {number} One decimal keeps drags smooth. */
const round = (value) => Math.round(value * 10) / 10;

/**
 * Computes a position for every node of the investigation.
 *
 * - a stored `node.position` (a manual drag, AC17) always wins;
 * - remaining nodes are placed on rings sorted by `node.depth` (seeds first),
 *   each node of a ring spread evenly with a per-ring angular offset so child
 *   rings do not stack exactly on their parents;
 * - radii are scaled proportionally when the deepest ring would leave the
 *   canvas, so every coordinate stays finite and inside the world.
 *
 * Pure and deterministic: the same nodes always produce the same layout,
 * which is what makes the smoke tests (and drag persistence) reliable.
 *
 * @param {WorkspaceNode[]} nodes
 * @param {{ width?: number, height?: number }} [options]
 * @returns {Map<string, Point>} node id → center position.
 */
export function computeGraphLayout(nodes, options = {}) {
  const positions = new Map();
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return positions;
  }
  const width = options.width ?? GRAPH_WIDTH;
  const height = options.height ?? GRAPH_HEIGHT;
  const center = { x: width / 2, y: height / 2 };
  const maxRadius = Math.min(width, height) / 2 - EDGE_MARGIN;

  /** @type {Map<number, WorkspaceNode[]>} */
  const rings = new Map();
  for (const node of nodes) {
    const depth = Number.isFinite(node.depth) && node.depth >= 0 ? Math.floor(node.depth) : 1;
    const ring = rings.get(depth);
    if (ring) {
      ring.push(node);
    } else {
      rings.set(depth, [node]);
    }
  }
  const depths = [...rings.keys()].sort((a, b) => a - b);
  const rawMax = SEED_RADIUS + (depths.length - 1) * RING_GAP;
  const scale = rawMax > maxRadius ? maxRadius / rawMax : 1;

  depths.forEach((depth, ringIndex) => {
    const ringNodes = rings.get(depth) ?? [];
    const radius = (SEED_RADIUS + ringIndex * RING_GAP) * scale;
    ringNodes.forEach((node, index) => {
      const stored = node.position;
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
        positions.set(node.id, { x: stored.x, y: stored.y });
        return;
      }
      if (depths.length === 1 && ringNodes.length === 1) {
        positions.set(node.id, center);
        return;
      }
      // Per-depth angular offset: rings read as layers, not as spokes.
      const angle = (index / ringNodes.length) * Math.PI * 2 - Math.PI / 2 + depth * 0.35;
      positions.set(node.id, {
        x: round(center.x + Math.cos(angle) * radius),
        y: round(center.y + Math.sin(angle) * radius),
      });
    });
  });
  return positions;
}
