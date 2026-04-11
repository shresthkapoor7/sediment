import { TimelineData, TimelineNode } from "./types";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;
export const LANE_HEIGHT = 160;
export const GAP_X = 80;
export const PADDING_X = 60;
export const PADDING_Y = 80;

// ── Numeric ID counter — owned entirely by the frontend, LLM never touches this ──

let _nextId = 1;
function nextId(): number { return _nextId++; }
function resetIds() { _nextId = 1; }

// ── Raw paper format — parentIndex is 0-based index into the array, null = root ──

interface RawPaper {
  title: string;
  year: number;
  summary: string;
  detail?: string;
  authors?: string[];
  arxivId?: string;
  parentIndex: number | null;
  lane: number;
}

// Main timeline (initial search result) — sorted chronologically by year
// parentIndex refers to the position of the parent in THIS array after sort-by-year
// To keep it maintainable, we define them in year order so parentIndex is stable.
const papers: RawPaper[] = [
  // index 0
  {
    title: "The Perceptron",
    year: 1958,
    authors: ["Frank Rosenblatt"],
    summary: "First algorithmic model of a biological neuron for pattern recognition.",
    detail: "Rosenblatt's perceptron was the first machine learning algorithm that could learn from examples. Implemented on the IBM 704, it demonstrated that a simple linear threshold unit could be trained to classify visual patterns. The algorithm updated weights based on errors, a principle that still underlies modern neural networks. Despite its limitations — it could only solve linearly separable problems — it sparked intense interest in machine learning and laid the conceptual groundwork for everything that followed.",
    parentIndex: null,
    lane: 0,
  },
  // index 1
  {
    title: "Backpropagation",
    year: 1986,
    authors: ["David Rumelhart", "Geoffrey Hinton", "Ronald Williams"],
    summary: "Efficient gradient computation enables training of multi-layer networks.",
    detail: "The 1986 Nature paper by Rumelhart, Hinton and Williams showed that the chain rule of calculus could be applied efficiently to compute gradients through multiple layers — a technique now called backpropagation. This made it practical to train deep networks for the first time. Although the algorithm had been described earlier by others, this paper demonstrated its power on real tasks and triggered a renaissance in connectionist AI research, ending the first AI winter.",
    arxivId: "cs/9605103",
    parentIndex: 0,
    lane: 0,
  },
  // index 2
  {
    title: "Recurrent Neural Networks",
    year: 1990,
    authors: ["Jeffrey Elman"],
    summary: "Networks with memory — sequential data processing through hidden state.",
    detail: "Elman's 1990 paper introduced the Simple Recurrent Network (SRN), later called the Elman network. By feeding the hidden layer's previous output back as additional input, the network develops an implicit memory of past context. This made neural networks applicable to sequential data like language, speech, and time series for the first time. The paper also introduced the concept of training on truncated sequences — still used in modern RNNs. The fundamental challenge it exposed — forgetting over long sequences — would motivate LSTM seven years later.",
    parentIndex: 1,
    lane: 0,
  },
  // index 3
  {
    title: "Long Short-Term Memory",
    year: 1997,
    authors: ["Sepp Hochreiter", "Jürgen Schmidhuber"],
    summary: "Gated architecture solving the vanishing gradient problem in sequences.",
    detail: "Hochreiter and Schmidhuber's LSTM paper tackled the vanishing gradient problem head-on. Standard RNNs lose gradient signal exponentially as it propagates back through time, making it impossible to learn long-range dependencies. LSTM's solution was elegant: a cell state running through the sequence with three learned gates (input, forget, output) controlling what information to write, erase, and read. This architecture dominated sequence modeling for two decades and powered breakthroughs in speech recognition, machine translation, and language modeling before the transformer era.",
    parentIndex: 2,
    lane: 0,
  },
  // index 4
  {
    title: "Word2Vec",
    year: 2013,
    authors: ["Tomas Mikolov", "Ilya Sutskever", "Kai Chen", "Greg Corrado", "Jeffrey Dean"],
    summary: "Dense vector representations capture semantic relationships between words.",
    detail: "Word2Vec introduced two architectures — CBOW and Skip-gram — that could learn dense word embeddings from raw text at scale. The resulting vectors had striking geometric properties: vector(King) − vector(Man) + vector(Woman) ≈ vector(Queen). These representations transferred remarkably well to downstream tasks, establishing the pre-training + fine-tuning paradigm that dominates NLP today. The Skip-gram model's insight — that a word's meaning is defined by its context — connects to distributional semantics and remains fundamental to how language models are trained.",
    arxivId: "1301.3781",
    parentIndex: 3,
    lane: 1,
  },
  // index 5
  {
    title: "Attention Mechanism",
    year: 2014,
    authors: ["Dzmitry Bahdanau", "Kyunghyun Cho", "Yoshua Bengio"],
    summary: "Dynamic weighting lets models focus on relevant parts of the input.",
    detail: "Bahdanau et al. introduced additive attention to solve the bottleneck in encoder-decoder translation models — the entire source sentence was compressed into a single fixed vector before decoding. Their solution: allow the decoder to look back at all encoder states and learn which ones to attend to at each decoding step. The attention weights became interpretable alignment scores. This paper directly inspired the self-attention mechanism in transformers and remains one of the most influential ideas in deep learning.",
    arxivId: "1409.0473",
    parentIndex: 3,
    lane: 0,
  },
  // index 6
  {
    title: "Attention Is All You Need",
    year: 2017,
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin"],
    summary: "Self-attention replaces recurrence — parallel, scalable sequence modeling.",
    detail: "The transformer architecture replaced recurrence entirely with self-attention, enabling full parallelization during training. Each token attends to every other token in the sequence simultaneously, and multi-head attention allows the model to capture different relationship types in parallel. Positional encodings inject sequence order since attention is permutation-invariant. The result was a model that trained faster, scaled better, and outperformed LSTMs on translation benchmarks. The transformer became the backbone of every major language model that followed.",
    arxivId: "1706.03762",
    parentIndex: 5,
    lane: 0,
  },
  // index 7
  {
    title: "BERT",
    year: 2018,
    authors: ["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
    summary: "Bidirectional pre-training captures deep context for language understanding.",
    detail: "BERT (Bidirectional Encoder Representations from Transformers) pre-trained a transformer encoder on masked language modeling — randomly masking tokens and predicting them from both left and right context. Unlike GPT's left-to-right language model, BERT's bidirectionality gives it richer contextual representations. Fine-tuning BERT with a single additional layer achieved state-of-the-art on 11 NLP benchmarks simultaneously. It demonstrated that pre-trained representations could transfer broadly and cheaply, making high-quality NLP accessible without massive compute.",
    arxivId: "1810.04805",
    parentIndex: 6,
    lane: 1,
  },
  // index 8
  {
    title: "GPT",
    year: 2018,
    authors: ["Alec Radford", "Karthik Narasimhan", "Tim Salimans", "Ilya Sutskever"],
    summary: "Autoregressive pre-training on massive text corpora for generation.",
    detail: "OpenAI's first GPT model established the generative pre-training paradigm: train a transformer decoder to predict the next token on a large text corpus, then fine-tune on specific tasks. While BERT focused on understanding, GPT prioritized generation. The key insight was that a single language modeling objective on diverse text produced representations useful for a wide range of tasks. GPT set the template for GPT-2, GPT-3, and the entire lineage of autoregressive language models.",
    parentIndex: 6,
    lane: 0,
  },
  // index 9
  {
    title: "GPT-3",
    year: 2020,
    authors: ["Tom Brown", "Benjamin Mann", "Nick Ryder", "et al.", "OpenAI"],
    summary: "175B parameters — few-shot learning emerges from scale alone.",
    detail: "GPT-3 scaled the autoregressive language model to 175 billion parameters — 100× larger than GPT-2. The surprising discovery was few-shot learning: by conditioning the model on a few examples in the prompt, it could perform tasks it was never explicitly trained on. This emergent capability suggested that scale alone could substitute for task-specific training, challenging the fine-tuning paradigm. GPT-3's API democratized access to large language models and sparked the commercial AI boom that followed.",
    arxivId: "2005.14165",
    parentIndex: 8,
    lane: 0,
  },
  // index 10
  {
    title: "Large Language Models",
    year: 2023,
    authors: ["Various"],
    summary: "Foundation models powering reasoning, code generation, and agents.",
    detail: "The era of large language models (LLMs) saw models like GPT-4, Claude, Gemini, and LLaMA reach capabilities that appeared qualitatively different from earlier systems. Instruction tuning and RLHF aligned models to follow natural language instructions. Chain-of-thought prompting unlocked multi-step reasoning. Tool use and agents extended models beyond text generation into action. LLMs became foundation models — pretrained once and adapted to thousands of tasks — representing a paradigm shift in how AI systems are built and deployed.",
    parentIndex: 9,
    lane: 0,
  },
];

// ── Sub-lineage registry ──
// parentIndex is 0-based index into THIS sub-array (after sort by year), null = first node

interface SubRawPaper {
  title: string;
  year: number;
  summary: string;
  parentIndex: number | null;
}

const SUB_LINEAGES: Record<string, SubRawPaper[]> = {
  "neural network": [
    // index 0
    { title: "McCulloch-Pitts Neuron",  year: 1943, summary: "First mathematical model of a neuron — binary threshold logic.", parentIndex: null },
    // index 1
    { title: "Hebbian Learning",        year: 1949, summary: '"Neurons that fire together wire together" — first learning rule.', parentIndex: 0 },
    // index 2
    { title: "The Perceptron",          year: 1958, summary: "First trainable neural network for supervised classification.", parentIndex: 1 },
    // index 3
    { title: "XOR Problem",             year: 1969, summary: "Minsky & Papert show single-layer networks can't learn XOR — AI winter begins.", parentIndex: 2 },
    // index 4
    { title: "Neocognitron",            year: 1980, summary: "Hierarchical feature extraction inspired by visual cortex — precursor to CNNs.", parentIndex: 3 },
  ],

  recurrent: [
    // index 0
    { title: "Hopfield Network",        year: 1982, summary: "Associative memory via recurrent connections with energy-based dynamics.", parentIndex: null },
    // index 1
    { title: "Elman Network",           year: 1990, summary: "Simple recurrent network with context units for sequence processing.", parentIndex: 0 },
    // index 2
    { title: "Backprop Through Time",   year: 1990, summary: "Unrolling recurrent networks to train with standard backpropagation.", parentIndex: 1 },
    // index 3
    { title: "Bidirectional RNN",       year: 1997, summary: "Processing sequences in both directions for richer context.", parentIndex: 2 },
  ],

  embedding: [
    // index 0
    { title: "Latent Semantic Analysis", year: 1988, summary: "SVD on term-document matrices reveals latent semantic structure.", parentIndex: null },
    // index 1
    { title: "GloVe",                   year: 2014, summary: "Global co-occurrence statistics produce word vectors with linear substructures.", parentIndex: 0 },
    // index 2
    { title: "fastText",                year: 2016, summary: "Subword embeddings handle morphology and rare words gracefully.", parentIndex: 1 },
    // index 3
    { title: "ELMo",                    year: 2018, summary: "Contextualized embeddings from bidirectional LSTMs — words mean different things in context.", parentIndex: 2 },
  ],

  attention: [
    // index 0
    { title: "Soft Attention",          year: 2014, summary: "Differentiable attention over image regions for caption generation.", parentIndex: null },
    // index 1
    { title: "Memory Networks",         year: 2015, summary: "External memory with attention-based read/write for question answering.", parentIndex: 0 },
    // index 2
    { title: "Self-Attention",          year: 2016, summary: "Attending to different positions within the same sequence for representation.", parentIndex: 1 },
    // index 3
    { title: "Multi-Head Attention",    year: 2017, summary: "Parallel attention heads capture different relationship types simultaneously.", parentIndex: 2 },
  ],

  transformer: [
    // index 0
    { title: "Sequence-to-Sequence",    year: 2014, summary: "Encoder-decoder architecture maps variable-length input to output.", parentIndex: null },
    // index 1
    { title: "Bahdanau Attention",      year: 2015, summary: "Additive attention mechanism eliminates information bottleneck in seq2seq.", parentIndex: 0 },
    // index 2
    { title: "Layer Normalization",     year: 2016, summary: "Normalizing across features stabilizes training of deep networks.", parentIndex: 1 },
    // index 3
    { title: "Positional Encoding",     year: 2017, summary: "Sinusoidal position signals let attention models understand token order.", parentIndex: 2 },
  ],
};

const KEYWORD_MAP: [RegExp, string][] = [
  [/neural\s*net/i,        "neural network"],
  [/perceptron/i,          "neural network"],
  [/neuron/i,              "neural network"],
  [/recur/i,               "recurrent"],
  [/rnn|lstm|gru/i,        "recurrent"],
  [/embed/i,               "embedding"],
  [/word2vec|glove|word\s*vector/i, "embedding"],
  [/attention|self.attention/i, "attention"],
  [/transform/i,           "transformer"],
  [/seq2seq|encoder.decoder/i, "transformer"],
];

function findSubLineage(query: string): SubRawPaper[] {
  for (const [pattern, key] of KEYWORD_MAP) {
    if (pattern.test(query)) return SUB_LINEAGES[key];
  }
  const lower = query.toLowerCase();
  for (const key of Object.keys(SUB_LINEAGES)) {
    if (lower.includes(key)) return SUB_LINEAGES[key];
  }
  return SUB_LINEAGES["neural network"];
}

// ── Generate initial timeline ──

export function generateTimeline(): TimelineData {
  resetIds();

  // Papers are already in year order — sort anyway to be safe
  const sorted = [...papers].sort((a, b) => a.year - b.year);

  const nodes: Record<number, TimelineNode> = {};
  const adjacency: Record<number, number[]> = {};
  const idByIndex: number[] = []; // sorted-array-index → assigned numeric ID

  const lanePositions: Record<number, number> = {};
  let maxLane = 0;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const id = nextId();
    idByIndex.push(id);

    if (lanePositions[p.lane] === undefined) lanePositions[p.lane] = 0;
    const x = PADDING_X + lanePositions[p.lane] * (NODE_WIDTH + GAP_X);
    const y = PADDING_Y + p.lane * LANE_HEIGHT;
    lanePositions[p.lane]++;
    maxLane = Math.max(maxLane, p.lane);

    const parentId = p.parentIndex !== null ? idByIndex[p.parentIndex] : null;

    nodes[id] = {
      id,
      paper: {
        id,
        openalexId: `mock-${id}`,
        title: p.title,
        year: p.year,
        summary: p.summary,
        detail: p.detail,
        authors: p.authors,
        arxivId: p.arxivId,
      },
      x, y,
      lane: p.lane,
      parentId,
      expanded: false,
      generation: 0,
    };

    adjacency[id] = [];
    if (parentId !== null) {
      adjacency[parentId].push(id);
    }
  }

  return {
    nodes,
    adjacency,
    lanes: maxLane + 1,
    rootId: idByIndex[0],
    expansions: [],
  };
}

// ── Merge a sub-lineage into the existing graph ──

export function mergeSubLineage(
  sourceNodeId: number,
  query: string,
  existing: TimelineData
): {
  nodes: Record<number, TimelineNode>;
  adjacency: Record<number, number[]>;
  lanes: number;
  generation: number;
} {
  const sourceNode = existing.nodes[sourceNodeId];
  if (!sourceNode) return { nodes: {}, adjacency: {}, lanes: existing.lanes, generation: 0 };

  const subPapers = findSubLineage(query);
  const newLane = existing.lanes;

  // Find current max generation
  let maxGen = 0;
  for (const n of Object.values(existing.nodes)) {
    if (n.generation > maxGen) maxGen = n.generation;
  }
  const generation = maxGen + 1;

  const newNodes: Record<number, TimelineNode> = {};
  const newAdj: Record<number, number[]> = {};

  // Dedup by title::year
  const existingByTitleYear = new Map<string, number>();
  for (const n of Object.values(existing.nodes)) {
    existingByTitleYear.set(`${n.paper.title}::${n.paper.year}`, n.id);
  }

  // Map: sorted-array-index → actual numeric ID (may point to existing node)
  const idByIndex: number[] = [];

  const sorted = [...subPapers].sort((a, b) => a.year - b.year);
  let posInLane = 0;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const dedupKey = `${p.title}::${p.year}`;
    const existingId = existingByTitleYear.get(dedupKey);

    if (existingId !== undefined) {
      // Paper already in graph — map to it, create convergence edge if needed
      idByIndex.push(existingId);

      const fromId = p.parentIndex !== null ? idByIndex[p.parentIndex] : sourceNodeId;
      if (fromId !== existingId) {
        // Add convergence edge to adjacency patch (fromId may be new or existing)
        if (!newAdj[fromId]) newAdj[fromId] = [];
        if (!newAdj[fromId].includes(existingId)) newAdj[fromId].push(existingId);
      }
      continue;
    }

    const id = nextId();
    idByIndex.push(id);

    const x = sourceNode.x + posInLane * (NODE_WIDTH + GAP_X);
    const y = PADDING_Y + newLane * LANE_HEIGHT;
    posInLane++;

    const parentId = p.parentIndex !== null ? idByIndex[p.parentIndex] : sourceNodeId;

    newNodes[id] = {
      id,
      paper: { id, openalexId: `mock-${id}`, title: p.title, year: p.year, summary: p.summary },
      x, y,
      lane: newLane,
      parentId,
      expanded: false,
      generation,
    };

    newAdj[id] = [];
    if (!newAdj[parentId]) newAdj[parentId] = [];
    newAdj[parentId].push(id);
  }

  return {
    nodes: newNodes,
    adjacency: newAdj,
    lanes: Object.keys(newNodes).length > 0 ? newLane + 1 : newLane,
    generation,
  };
}

export const NODE_DIMENSIONS = { width: NODE_WIDTH, height: NODE_HEIGHT };

// ── Chat response simulation ──

export interface LineageSuggestion {
  topic: string;      // display name e.g. "Neural Networks"
  nodeCount: number;
  query: string;      // keyword to pass to mergeSubLineage
}

export interface ChatResponse {
  text: string;
  suggestion?: LineageSuggestion;
}

const CANNED_RESPONSES: Record<string, { text: string; topic: string }> = {
  "neural network": {
    text: "Neural networks are computing systems loosely inspired by biological neurons. A single neuron computes a weighted sum of its inputs and fires if that sum exceeds a threshold. Stack layers of these, train with backpropagation, and you get a universal function approximator. The lineage stretches back to McCulloch & Pitts in 1943 — decades before anyone had the compute to make them work.",
    topic: "Neural Networks",
  },
  recurrent: {
    text: "Recurrent neural networks process sequences by threading a hidden state through each timestep — the output at step t feeds back as input at step t+1. This gives them implicit memory, making them natural for language, speech, and time series. The catch: gradients vanish (or explode) over long sequences, which is exactly what LSTM was designed to fix.",
    topic: "Recurrent Networks",
  },
  embedding: {
    text: "Word embeddings map discrete tokens into a continuous vector space where semantic relationships become geometry — king − man + woman ≈ queen. The key insight is distributional semantics: words that appear in similar contexts have similar meanings. This representational foundation underlies every modern language model.",
    topic: "Word Embeddings",
  },
  attention: {
    text: "Attention lets a model dynamically weight which parts of the input to focus on at each decoding step, instead of compressing everything into a fixed vector. Bahdanau introduced it for translation in 2014 — the decoder learned to 'look back' at encoder states. Self-attention extended this so every token attends to every other token in the same sequence.",
    topic: "Attention Mechanisms",
  },
  transformer: {
    text: "The transformer replaced recurrence entirely with self-attention, making training fully parallelizable. Each token attends to every other simultaneously via multi-head attention, with positional encodings injecting sequence order. It trained faster, scaled better, and outperformed LSTMs on every benchmark — then became the backbone of every major model that followed.",
    topic: "Transformer Architecture",
  },
};

function findResponseKey(query: string): string | null {
  for (const [pattern, key] of KEYWORD_MAP) {
    if (pattern.test(query)) return key;
  }
  const lower = query.toLowerCase();
  for (const key of Object.keys(SUB_LINEAGES)) {
    if (lower.includes(key)) return key;
  }
  return null;
}

export function generateChatResponse(query: string): ChatResponse {
  const key = findResponseKey(query);

  if (key && CANNED_RESPONSES[key]) {
    const { text, topic } = CANNED_RESPONSES[key];
    const nodeCount = SUB_LINEAGES[key].length;
    return {
      text,
      suggestion: { topic, nodeCount, query: key },
    };
  }

  // Generic fallback — no lineage suggestion
  return {
    text: `That's a great question about "${query}". The papers in this timeline collectively shaped how we think about this. Try asking about a specific concept — like "neural network", "attention", or "transformer" — and I can trace its lineage directly in the graph.`,
  };
}
