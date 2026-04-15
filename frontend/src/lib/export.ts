import JSZip from "jszip";
import { TimelineData } from "./types";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function formatTag(concept: string): string {
  return concept.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
}

function getFilename(title: string, openalexId: string): string {
  return slugify(title) || openalexId;
}

function paperToMarkdown(nodeId: number, data: TimelineData, folderName: string): string {
  const node = data.nodes[nodeId];
  const paper = node.paper;

  const tags = (paper.concepts ?? []).map(formatTag).join(", ");
  const authors = (paper.authors ?? []).map((a) => JSON.stringify(a)).join(", ");

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(paper.title)}`,
    `year: ${paper.year ?? "unknown"}`,
    `authors: [${authors}]`,
    `openalex: ${JSON.stringify(`https://openalex.org/${paper.openalexId}`)}`,
    (paper.oaUrl || paper.doi) ? `link: ${JSON.stringify(paper.oaUrl ?? `https://doi.org/${paper.doi}`)}` : null,
    paper.type ? `type: ${paper.type}` : null,
    tags ? `tags: [${tags}]` : null,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const lines: string[] = [frontmatter, "", `# ${paper.title}`, ""];

  if (paper.summary) {
    lines.push(`> ${paper.summary}`, "");
  }

  if (paper.detail) {
    lines.push("## Abstract", "", paper.detail, "");
  }

  const wikilink = (title: string, openalexId: string, year: number | null) =>
    `[[${folderName}/${getFilename(title, openalexId)}|${title}]] (${year ?? "?"})`;

  // Built on — immediate parent node
  const parentNodeId = node.parentId;
  const parents: string[] = [];
  if (parentNodeId !== null && data.nodes[parentNodeId]) {
    const parent = data.nodes[parentNodeId].paper;
    parents.push(wikilink(parent.title, parent.openalexId, parent.year));
  }

  // Led to — child nodes in adjacency
  const ledTo: string[] = (data.adjacency[nodeId] ?? [])
    .map((childId) => data.nodes[childId])
    .filter(Boolean)
    .map((childNode) => wikilink(childNode.paper.title, childNode.paper.openalexId, childNode.paper.year));

  if (parents.length > 0 || ledTo.length > 0) {
    if (parents.length > 0) {
      lines.push("### Built on", ...parents.map((p) => `- ${p}`), "");
    }
    if (ledTo.length > 0) {
      lines.push("### Led to", ...ledTo.map((p) => `- ${p}`), "");
    }
  }

  return lines.join("\n");
}

export async function exportObsidianZip(
  timelineData: TimelineData,
  lineageName: string,
): Promise<void> {
  const zip = new JSZip();
  const folderName = slugify(lineageName) || "sediment-export";
  const folder = zip.folder(folderName)!;

  const nodeList = Object.values(timelineData.nodes)
    .sort((a, b) => (a.paper.year ?? 0) - (b.paper.year ?? 0))
    .map((n) => `- [[${folderName}/${getFilename(n.paper.title, n.paper.openalexId)}|${n.paper.title}]] (${n.paper.year ?? "?"})`)
    .join("\n");

  const agentsMd = [
    `# ${lineageName} — Research Lineage`,
    "",
    `This vault was exported from [Sediment](https://sediment-seven.vercel.app/), a research lineage explorer.`,
    `The user traced the intellectual history of: **${lineageName}**`,
    "",
    "## How this vault is structured",
    "",
    "Each file in this folder is a research paper. Papers are connected via wikilinks:",
    "- **Built on** — foundational works this paper directly builds upon",
    "- **Led to** — later works that this paper directly influenced",
    "",
    "Following the wikilinks from any paper traces the full lineage forward or backward in time.",
    "",
    "## Papers in this lineage (oldest to newest)",
    "",
    nodeList,
    "",
    "## Instructions for your agent",
    "",
    `The user's original research interest was: **${lineageName}**`,
    "",
    "When helping the user explore this vault:",
    "- Start from the newest paper (closest to the user's query) and trace backwards to understand foundations",
    "- Use the Built on / Led to links to navigate the influence graph",
    "- Each paper's frontmatter contains the link to read the full paper",
    "- Summaries are one-sentence Claude-generated descriptions of each paper's role in the lineage",
  ].join("\n");

  folder.file("agents.md", agentsMd);

  const usedFilenames = new Set<string>();
  for (const nodeIdStr of Object.keys(timelineData.nodes)) {
    const nodeId = Number(nodeIdStr);
    const node = timelineData.nodes[nodeId];
    const baseName = getFilename(node.paper.title, node.paper.openalexId);
    let filename = baseName;
    let counter = 1;
    while (usedFilenames.has(filename)) {
      filename = `${baseName}-${counter++}`;
    }
    usedFilenames.add(filename);
    const content = paperToMarkdown(nodeId, timelineData, folderName);
    folder.file(`${filename}.md`, content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folderName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
