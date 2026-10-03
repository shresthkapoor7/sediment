# Architecture diagrams

Detailed subsystem flows for Sediment. See the [main architecture overview](../README.md#architecture) for how these components fit together.

## Lineage discovery

Lineage discovery turns a query into papers, relationships, and explanatory notes using OpenAlex metadata and references. It does not require downloading full papers.

```mermaid
flowchart TD
    Q["User query"] --> MODE{"Trace mode"}

    MODE --> S["Standard<br/>Search OpenAlex"]
    S --> SEED["Choose seed paper"]
    SEED --> REF["Fetch references<br/>Find related earlier papers if sparse"]
    REF --> RANK["Claude ranks ancestors<br/>and explains contributions"]
    RANK --> GRAPH["Build lineage graph"]

    MODE --> D["Deep<br/>Claude directs the research"]
    D --> TOOLS["Search papers ↔ Inspect references"]
    TOOLS --> PROPOSE["Propose papers, edges, and notes"]
    PROPOSE --> VALIDATE{"Validated final proposal?"}
    VALIDATE -->|Yes| GRAPH
    VALIDATE -->|No proposal after tool loop| S

    GRAPH --> NOTES["Attach notes, trace summary,<br/>and research evidence"]
    NOTES --> OUT["Return chronological graph"]
```

## Research agent

The research agent answers questions about an individual paper or the whole timeline. Saved conversations restore recent messages and a rolling summary; paper chat also accepts a selected excerpt, while timeline chat accepts paper mentions and canvas context.

```mermaid
flowchart TD
    Q["Chat question"] --> CTX["Load paper/timeline context<br/>Restore saved conversation"]
    CTX --> C["Claude chooses the next step"]
    C --> T["Run tools<br/>Research · Retrieve evidence · Edit canvas"]
    T --> C
    C --> ANSWER["Stream answer and citations<br/>Return canvas changes"]
    ANSWER --> MEMORY["Save chat history<br/>Update rolling summary when needed"]
    ANSWER --> UI["Frontend applies canvas changes<br/>and saves graph separately"]
```

## Paper ingestion and retrieval

Full-text ingestion is requested separately from lineage discovery. A ready cached document is reused; otherwise the backend locates an accessible source and indexes it for later questions.

```mermaid
flowchart TD
    REQ["Confirmed full-paper request"] --> CACHE{"Ready document cached?"}
    CACHE -->|Yes| READY["Paper ready to search"]
    CACHE -->|No| SOURCE["Locate and download text<br/>OpenAlex TEI/PDF → OA PDF → Unpaywall"]
    SOURCE --> LEASE["Checksum and ingestion lease<br/>Reuse or claim document"]
    LEASE --> PARSE["Parse structured text<br/>TEI XML or Docling PDF"]
    PARSE --> CHUNK["Create overlapping chunks<br/>Keep section and page metadata"]
    CHUNK --> EMBED["Voyage document embeddings"]
    EMBED --> DB[("Supabase pgvector<br/>Store chunks and mark document ready")]
    DB --> READY

    Q["Paper or timeline question"] --> QE["Voyage query embedding"]
    QE --> SEARCH["Vector search over ready documents"]
    DB --> SEARCH
    SEARCH --> RERANK["Voyage reranking"]
    RERANK --> EVIDENCE["Relevant chunks + citations<br/>Return to agent or API caller"]
```

## Tests and evaluations

Unit tests check backend behavior, while model evaluations measure the quality of generated lineage and explanations. The canonical evaluation covers lineage API workflows; it does not evaluate chat, document ingestion, database persistence, browser rendering, or deployment infrastructure.

```mermaid
flowchart TD
    CASE["Topic + workflow"] --> API["Production lineage API<br/>Search · Deep trace · Clarify · Expand"]
    API --> CAP["Capture retrieved evidence,<br/>generation inputs, and final graph"]
    CAP --> CHECK["Deterministic checks<br/>Paper recall · Edges · Notes · Structure"]
    CAP --> FAITH["Generation faithfulness<br/>Claims versus actual model inputs"]
    CAP --> RECALL["Context recall<br/>Retrieved evidence versus expected facts"]
    CAP --> CORRECT["Scientific correctness<br/>Final output versus independent reference"]
    GOLD["Curated papers and scientific expectations"] --> CHECK
    GOLD --> RECALL
    GOLD --> CORRECT
    CHECK --> REPORT["Per-case results and JSONL report"]
    FAITH --> REPORT
    RECALL --> REPORT
    CORRECT --> REPORT
```
