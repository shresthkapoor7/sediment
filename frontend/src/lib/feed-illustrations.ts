// Decorative topic illustrations, never figures or findings from the paper.
export const feedIllustrations = [
  { id: "neural-networks", variants: ["attention", "latent-space"], tags: ["machine learning", "neural network", "deep learning", "transformer"] },
  { id: "language", variants: ["token-sequence", "syntax-tree"], tags: ["language model", "llm", "nlp", "linguistic", "text generation"] },
  { id: "robotics", variants: ["robot-arm", "navigation"], tags: ["robot", "robotics", "manipulation", "embodied"] },
  { id: "vision", variants: ["feature-map", "image-patches"], tags: ["vision", "segmentation", "image", "visual", "detection"] },
  { id: "reinforcement", variants: ["decision-tree", "reward-landscape"], tags: ["reinforcement", "policy", "reward", "agent"] },
  { id: "graphs", variants: ["network-clusters", "graph-paths"], tags: ["graph", "network science", "knowledge graph", "retrieval"] },
  { id: "neuroscience", variants: ["synapses", "brain-waves"], tags: ["neuroscience", "brain", "memory", "cognitive", "sleep"] },
  { id: "genetics", variants: ["chromosomes", "sequence-ladder"], tags: ["genetic", "genome", "dna", "rna", "crispr"] },
  { id: "cells", variants: ["cell-division", "membrane"], tags: ["cell", "cellular", "microbiology", "bacteria", "immune"] },
  { id: "molecules", variants: ["protein-fold", "crystal-lattice"], tags: ["molecular", "molecule", "chemistry", "protein", "catalyst"] },
  { id: "quantum", variants: ["wave-interference"], tags: ["quantum", "particle", "entanglement", "photon"] },
  { id: "space", variants: ["orbital-system"], tags: ["space", "astronomy", "planet", "galaxy", "cosmology"] },
  { id: "climate", variants: ["atmosphere"], tags: ["climate", "weather", "warming", "carbon", "atmosphere"] },
  { id: "ocean", variants: ["fluid-flow"], tags: ["ocean", "marine", "water", "hydrology", "wave"] },
  { id: "energy", variants: ["solar-array"], tags: ["energy", "battery", "solar", "electricity", "renewable"] },
  { id: "ecology", variants: ["branching-canopy"], tags: ["ecology", "biodiversity", "forest", "plant", "ecosystem"] },
  { id: "mathematics", variants: ["parametric-curves"], tags: ["mathematics", "theorem", "geometry", "algebra", "topology"] },
  { id: "computing", variants: ["circuit-board"], tags: ["computing", "hardware", "processor", "semiconductor", "compiler"] },
  { id: "security", variants: ["encryption-rings"], tags: ["security", "privacy", "cryptography", "encryption", "attack"] },
  { id: "medicine", variants: ["heartbeat"], tags: ["medical", "medicine", "clinical", "health", "disease", "therapy"] },
] as const;

export function illustrationFor(paper: { id: string; title: string; abstract: string; topics: string[] }): string | null {
  const hash = [...paper.id].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0);
  // A deliberate mix of illustrated and text-only cards, stable across refreshes.
  if (hash % 4 === 0) return null;
  const matches = (text: string, tag: string) => new RegExp(`\\b${tag}(?:s|ing|al)?\\b`, "i").test(text);
  const ranked = feedIllustrations.map(item => ({ ...item, score: item.tags.reduce((score, tag) => score
    + (matches(paper.topics.join(" "), tag) ? 4 : 0)
    + (matches(paper.title, tag) ? 3 : 0)
    + (matches(paper.abstract, tag) ? 1 : 0), 0) })).filter(item => item.score > 0);
  if (!ranked.length) return null;
  const best = Math.max(...ranked.map(item => item.score));
  const choices = ranked.filter(item => item.score === best).flatMap(item => [item.id, ...item.variants]);
  return `/feed-illustrations/${choices[hash % choices.length]}.svg`;
}
