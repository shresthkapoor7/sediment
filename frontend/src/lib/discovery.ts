/* ──────────────────────────────────────────────────────────────
   Discovery graph — schema, palette, and layout

   A discovery graph is a three-layer feed-forward map:

     concept   →   sub-fields (topics)   →   papers

   The data shape here is the contract the backend/Claude fills in.
   Keep `DISCOVERY_GRAPH_JSON_SCHEMA` in sync with the interfaces so
   the model can emit a valid graph directly.
   ────────────────────────────────────────────────────────────── */

// ── Data schema (the JSON the backend produces) ──

export interface DiscoveryConcept {
  /** The thing the user is exploring, e.g. "AI for Games". */
  label: string;
  summary?: string;
}

export interface DiscoveryTopic {
  /** Stable slug, referenced by papers. */
  id: string;
  label: string;
  /** Short acronym for compact display, e.g. "RL". */
  short: string;
  summary?: string;
  /** Optional colour override; otherwise auto-assigned from the palette. */
  color?: string;
}

export interface DiscoveryPaper {
  id: string;
  title: string;
  year: number;
  /** Topic ids this paper belongs to (1+; multiple = a convergence). */
  topics: string[];
  summary?: string;
  authors?: string[];
}

export interface DiscoveryGraph {
  concept: DiscoveryConcept;
  topics: DiscoveryTopic[];
  papers: DiscoveryPaper[];
}

// JSON Schema (draft-07) describing DiscoveryGraph — hand this to the model.
export const DISCOVERY_GRAPH_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DiscoveryGraph",
  type: "object",
  required: ["concept", "topics", "papers"],
  additionalProperties: false,
  properties: {
    concept: {
      type: "object",
      required: ["label"],
      additionalProperties: false,
      properties: {
        label: { type: "string", description: "The concept being explored." },
        summary: { type: "string" },
      },
    },
    topics: {
      type: "array",
      description: "Sub-fields of the concept (the hidden layer).",
      items: {
        type: "object",
        required: ["id", "label", "short"],
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Stable slug referenced by papers." },
          label: { type: "string" },
          short: { type: "string", description: "Acronym for compact display." },
          summary: { type: "string" },
          color: { type: "string", description: "Optional CSS colour override." },
        },
      },
    },
    papers: {
      type: "array",
      description: "Papers (the output layer). Multiple topics = a convergence.",
      items: {
        type: "object",
        required: ["id", "title", "year", "topics"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          year: { type: "integer" },
          topics: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "ids from `topics` this paper belongs to.",
          },
          summary: { type: "string" },
          authors: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

// ── Palette ──
// Categorical CSS vars, already themed for light/dark in globals.css.
// Topics without an explicit colour cycle through these in order, so any
// number of topics gets a stable, on-brand colour automatically.
export const DISCOVERY_PALETTE = [
  "var(--cat-blue)",
  "var(--cat-purple)",
  "var(--cat-green)",
  "var(--cat-amber)",
  "var(--cat-rose)",
  "var(--cat-gray)",
] as const;

/** Map every topic id to a colour: explicit override, else next palette slot. */
export function assignTopicColors(topics: DiscoveryTopic[]): Record<string, string> {
  const colors: Record<string, string> = {};
  let auto = 0;
  for (const t of topics) {
    if (t.color) {
      colors[t.id] = t.color;
    } else {
      colors[t.id] = DISCOVERY_PALETTE[auto % DISCOVERY_PALETTE.length];
      auto += 1;
    }
  }
  return colors;
}

// ── Layout geometry (SVG/px space) ──

export const DISCOVERY_GEOMETRY = {
  worldW: 1720,
  columns: { input: 260, topic: 720, paper: 1200 },
  headerY: 70,
  topicGap: 168,
  paperGap: 120,
  vertMargin: 220,
  rInput: 34,
  rTopic: 17,
  rPaper: 11,
} as const;

export interface PlacedTopic extends DiscoveryTopic {
  x: number;
  y: number;
  color: string;
}
export interface PlacedPaper extends DiscoveryPaper {
  x: number;
  y: number;
}

export interface DiscoveryLayout {
  world: { w: number; h: number };
  cy: number;
  input: { data: DiscoveryConcept; x: number; y: number };
  topics: PlacedTopic[];
  papers: PlacedPaper[];
  topicById: Record<string, PlacedTopic>;
}

/** Turn a graph into placed nodes. Papers are ordered by the mean vertical
 *  index of their sub-fields so synapses stay untangled. */
export function layoutGraph(graph: DiscoveryGraph): DiscoveryLayout {
  const G = DISCOVERY_GEOMETRY;
  const colors = assignTopicColors(graph.topics);

  const contentH = Math.max(
    (graph.topics.length - 1) * G.topicGap,
    (graph.papers.length - 1) * G.paperGap,
    0,
  );
  const worldH = contentH + G.vertMargin * 2;
  const cy = worldH / 2;

  const column = <T,>(items: T[], x: number, gap: number) => {
    const start = cy - ((items.length - 1) * gap) / 2;
    return items.map((it, i) => ({ item: it, x, y: start + i * gap }));
  };

  const topics: PlacedTopic[] = column(graph.topics, G.columns.topic, G.topicGap).map(
    ({ item, x, y }) => ({ ...item, x, y, color: colors[item.id] }),
  );

  const topicIndex: Record<string, number> = {};
  graph.topics.forEach((t, i) => (topicIndex[t.id] = i));
  const meanIdx = (p: DiscoveryPaper) =>
    p.topics.reduce((s, id) => s + (topicIndex[id] ?? 0), 0) / Math.max(p.topics.length, 1);
  const ordered = [...graph.papers].sort((a, b) => meanIdx(a) - meanIdx(b));
  const papers: PlacedPaper[] = column(ordered, G.columns.paper, G.paperGap).map(
    ({ item, x, y }) => ({ ...item, x, y }),
  );

  const topicById: Record<string, PlacedTopic> = {};
  topics.forEach((t) => (topicById[t.id] = t));

  return {
    world: { w: G.worldW, h: worldH },
    cy,
    input: { data: graph.concept, x: G.columns.input, y: cy },
    topics,
    papers,
    topicById,
  };
}

/** Smooth S-curve synapse between two layers (horizontal tangents). */
export function synapsePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

// ── Sample graph (dummy content for the mockup) ──
// Colours omitted → auto-assigned from the palette.
export const SAMPLE_DISCOVERY_GRAPH: DiscoveryGraph = {
  concept: {
    label: "AI for Games",
    summary: "Methods that let agents learn, plan, and generate inside games.",
  },
  topics: [
    { id: "rl", label: "Reinforcement Learning", short: "RL", summary: "Agents learning from reward signals through trial and error." },
    { id: "search", label: "Search & Planning", short: "MCTS", summary: "Look-ahead over game trees, e.g. Monte-Carlo tree search." },
    { id: "pcg", label: "Procedural Content Gen", short: "PCG", summary: "Algorithmically generating levels, maps, and assets." },
    { id: "mas", label: "Multi-Agent Systems", short: "MAS", summary: "Many agents coordinating or competing in one environment." },
    { id: "llm", label: "Large Language Models", short: "LLMs", summary: "Language models as reasoning and control policies." },
  ],
  papers: [
    { id: "dqn", title: "Human-level control (DQN)", year: 2013, topics: ["rl"], authors: ["Mnih et al."], summary: "Deep Q-networks reach human-level play on Atari from pixels." },
    { id: "alphago", title: "AlphaGo", year: 2016, topics: ["rl", "search"], authors: ["Silver et al."], summary: "Policy/value networks plus tree search defeat a Go world champion." },
    { id: "wfc", title: "WaveFunctionCollapse", year: 2016, topics: ["pcg"], authors: ["Gumin"], summary: "Constraint-based tile generation from a single example image." },
    { id: "openai5", title: "OpenAI Five", year: 2019, topics: ["rl", "mas"], authors: ["OpenAI"], summary: "Team of RL agents reaches pro level at Dota 2." },
    { id: "muzero", title: "MuZero", year: 2019, topics: ["rl", "search"], authors: ["Schrittwieser et al."], summary: "Plans with a learned model, no rules given." },
    { id: "pcgrl", title: "PCGRL", year: 2020, topics: ["pcg", "rl"], authors: ["Khalifa et al."], summary: "Frames level generation as an RL control problem." },
    { id: "cicero", title: "CICERO (Diplomacy)", year: 2022, topics: ["llm", "mas", "search"], authors: ["Meta AI"], summary: "Language + planning to negotiate and play Diplomacy." },
    { id: "voyager", title: "Voyager", year: 2023, topics: ["rl", "llm"], authors: ["Wang et al."], summary: "An LLM-driven agent that writes skills to explore Minecraft." },
    { id: "genagents", title: "Generative Agents", year: 2023, topics: ["llm", "mas"], authors: ["Park et al."], summary: "LLM agents with memory simulate believable social behaviour." },
    { id: "mariogpt", title: "MarioGPT", year: 2023, topics: ["pcg", "llm"], authors: ["Sudhakaran et al."], summary: "Generates Mario levels from text prompts with a language model." },
    { id: "sima", title: "SIMA", year: 2024, topics: ["llm", "mas"], authors: ["DeepMind"], summary: "A generalist agent following language instructions across 3D games." },
  ],
};
