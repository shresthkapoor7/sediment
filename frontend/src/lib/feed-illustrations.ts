// Decorative topic illustrations, never figures or findings from the paper.
export const feedIllustrations = [
  { id: "neural-networks", tags: ["machine learning", "neural network", "deep learning", "transformer"] },
  { id: "language", tags: ["language model", "llm", "nlp", "linguistic", "text generation"] },
  { id: "robotics", tags: ["robot", "robotics", "manipulation", "embodied"] },
  { id: "vision", tags: ["vision", "segmentation", "image", "visual", "detection"] },
  { id: "reinforcement", tags: ["reinforcement", "policy", "reward", "agent"] },
  { id: "graphs", tags: ["graph", "network science", "knowledge graph", "retrieval"] },
  { id: "neuroscience", tags: ["neuroscience", "brain", "memory", "cognitive", "sleep"] },
  { id: "genetics", tags: ["genetic", "genome", "dna", "rna", "crispr"] },
  { id: "cells", tags: ["cell", "cellular", "microbiology", "bacteria", "immune"] },
  { id: "molecules", tags: ["molecular", "molecule", "chemistry", "protein", "catalyst"] },
  { id: "quantum", tags: ["quantum", "particle", "entanglement", "photon"] },
  { id: "space", tags: ["space", "astronomy", "planet", "galaxy", "cosmology"] },
  { id: "climate", tags: ["climate", "weather", "warming", "carbon", "atmosphere"] },
  { id: "ocean", tags: ["ocean", "marine", "water", "hydrology", "wave"] },
  { id: "energy", tags: ["energy", "battery", "solar", "electricity", "renewable"] },
  { id: "ecology", tags: ["ecology", "biodiversity", "forest", "plant", "ecosystem"] },
  { id: "mathematics", tags: ["mathematics", "theorem", "geometry", "algebra", "topology"] },
  { id: "computing", tags: ["computing", "hardware", "processor", "semiconductor", "compiler"] },
  { id: "security", tags: ["security", "privacy", "cryptography", "encryption", "attack"] },
  { id: "medicine", tags: ["medical", "medicine", "clinical", "health", "disease", "therapy"] },
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
  const choices = ranked.filter(item => item.score === best);
  return `/feed-illustrations/${choices[hash % choices.length].id}.svg`;
}
