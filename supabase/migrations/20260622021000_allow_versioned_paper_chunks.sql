-- Chunk indexes are unique within a parsed document, not across every version
-- of a paper. The original constraint prevented checksum-versioned reingestion.

alter table public.paper_chunks
  drop constraint if exists paper_chunks_openalex_id_chunk_index_key;

create unique index if not exists paper_chunks_document_chunk_key
  on public.paper_chunks (document_id, chunk_index)
  where document_id is not null;
