// Decorative topic illustrations, never figures or findings from the paper.
export const feedIllustrations = [
  { id: "neural-networks", variants: ["attention", "latent-space"], tags: ["machine learning", "neural network", "deep learning", "transformer"] },
  { id: "language", variants: ["token-sequence", "syntax-tree"], tags: ["language model", "llm", "nlp", "linguistic", "text generation"] },
  { id: "robotics", variants: ["robot-arm", "navigation"], tags: ["robot", "robotics", "manipulation", "embodied"] },
  { id: "vision", variants: ["feature-map", "image-patches"], tags: ["vision", "segmentation", "image", "visual", "detection"] },
  { id: "reinforcement", variants: ["decision-tree", "reward-landscape"], tags: ["reinforcement", "policy", "reward", "agent"] },
  { id: "graphs", variants: ["network-clusters", "graph-paths"], tags: ["graph", "network science", "knowledge graph", "retrieval"] },
  { id: "neuroscience", variants: ["synapses", "brain-waves"], tags: ["neuroscience", "brain", "memory", "cognitive", "sleep"] },
  { id: "genetics", variants: ["chromosomes", "read-alignment"], tags: ["genetic", "genome", "dna", "rna", "crispr"] },
  { id: "cells", variants: ["cell-division", "membrane"], tags: ["cell", "cellular", "microbiology", "bacteria", "immune"] },
  { id: "molecules", variants: ["protein-fold", "crystal-lattice"], tags: ["molecular", "molecule", "chemistry", "protein", "catalyst"] },
  { id: "quantum", variants: ["double-slit"], tags: ["quantum", "particle", "entanglement", "photon"] },
  { id: "space", variants: ["orbital-system"], tags: ["space", "astronomy", "planet", "galaxy", "cosmology"] },
  { id: "climate", variants: ["atmosphere"], tags: ["climate", "weather", "warming", "carbon", "atmosphere"] },
  { id: "ocean", variants: ["fluid-flow"], tags: ["ocean", "marine", "water", "hydrology", "wave"] },
  { id: "energy", variants: ["iv-curve"], tags: ["energy", "battery", "solar", "electricity", "renewable"] },
  { id: "ecology", variants: ["phylogeny"], tags: ["ecology", "biodiversity", "forest", "plant", "ecosystem"] },
  { id: "mathematics", variants: ["parametric-curves"], tags: ["mathematics", "theorem", "geometry", "algebra", "topology"] },
  { id: "computing", variants: ["circuit-board"], tags: ["computing", "hardware", "processor", "semiconductor", "compiler"] },
  { id: "security", variants: ["merkle-tree"], tags: ["security", "privacy", "cryptography", "encryption", "attack"] },
  { id: "medicine", variants: ["heartbeat"], tags: ["medical", "medicine", "clinical", "health", "disease", "therapy"] },
] as const;

const matches = (text: string, tag: string) => new RegExp(`\\b${tag}(?:s|ing|al)?\\b`, "i").test(text);
const hashOf = (id: string) => [...id].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0);
const src = (id: string) => `/feed-illustrations/${id}.svg`;

/** Every drawing that suits a paper, best topic match first, in a stable per-paper order. */
function candidatesFor(paper: { id: string; title: string; abstract: string; topics: string[] }): string[] {
  const hash = hashOf(paper.id);
  const ranked = feedIllustrations.map(item => ({ ...item, score: item.tags.reduce((score, tag) => score
    + (matches(paper.topics.join(" "), tag) ? 4 : 0)
    + (matches(paper.title, tag) ? 3 : 0)
    + (matches(paper.abstract, tag) ? 1 : 0), 0) })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const groups = ranked.length ? ranked : [...feedIllustrations];
  return groups.flatMap(item => {
    const ids: string[] = [item.id, ...item.variants];
    const start = hash % ids.length;
    return [...ids.slice(start), ...ids.slice(0, start)];
  });
}

export function illustrationFor(paper: { id: string; title: string; abstract: string; topics: string[] }): string {
  return src(candidatesFor(paper)[0]);
}

/**
 * Drawings for a run of papers, so cards near each other don't repeat one: each paper takes the first drawing
 * that suits it and hasn't appeared in the last few cards, and only reuses one when every suitable drawing has.
 */
export function illustrationsFor(papers: { id: string; title: string; abstract: string; topics: string[] }[], spacing = 6): Map<string, string> {
  const assigned = new Map<string, string>();
  const recent: string[] = [];
  for (const paper of papers) {
    const candidates = candidatesFor(paper);
    const fresh = candidates.find(id => !recent.includes(id))
      // Every suitable drawing is in use nearby: fall back to any drawing not shown recently.
      ?? feedIllustrations.flatMap(item => [item.id, ...item.variants] as string[]).find(id => !recent.includes(id))
      ?? candidates[0];
    assigned.set(paper.id, src(fresh));
    recent.push(fresh);
    if (recent.length > spacing) recent.shift();
  }
  return assigned;
}
