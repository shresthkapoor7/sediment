// Timeline layout constants — the only live exports extracted from the old dummy-data module.
const NODE_WIDTH = 320;
const NODE_HEIGHT = 172;

export const LANE_HEIGHT = 236;
export const GAP_X = 96;
export const PADDING_X = 60;
export const PADDING_Y = 80;

export const NODE_DIMENSIONS = { width: NODE_WIDTH, height: NODE_HEIGHT };

/** Bumped whenever the constants above change, so saved canvases can be re-spaced once on load. */
export const LAYOUT_VERSION = 2;
/** The most papers a canvas can hold; the agent's request is capped at the same number. */
export const MAX_CANVAS_PAPERS = 60;
/** The column and lane pitch canvases were saved with before LAYOUT_VERSION 2. */
export const LEGACY_PITCH = { x: 340, y: 160 };
