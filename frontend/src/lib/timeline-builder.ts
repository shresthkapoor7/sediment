import { LAYOUT_VERSION } from "./layout-constants";
import { TimelineData } from "./types";

/** A canvas with nothing on it yet. Node IDs start at 1, so a root of 0 points at no paper. */
export function createEmptyTimeline(): TimelineData {
  return {
    nodes: {},
    adjacency: {},
    edgeRelations: {},
    notes: {},
    noteEdges: [],
    lanes: 0,
    rootId: 0,
    expansions: [],
    layoutVersion: LAYOUT_VERSION,
  };
}
