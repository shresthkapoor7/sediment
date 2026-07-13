-- Keep this pipeline-incompatible statement in its own migration. The Supabase
-- migration runner executes CREATE INDEX CONCURRENTLY outside a transaction.
create index concurrently if not exists paper_documents_active_lease_idx
  on public.paper_documents (ingestion_lease_expires_at)
  where ingestion_status in ('fetching', 'parsing', 'embedding');
