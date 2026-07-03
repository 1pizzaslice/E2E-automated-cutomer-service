-- Milestone 7: KB retrieval index.
--
-- Adds an approximate-nearest-neighbour index over the KB chunk embeddings so
-- tenant-scoped semantic retrieval stays fast as chunk volume grows. We use
-- HNSW (available in pgvector >= 0.5, shipped by the pgvector/pgvector:pg17
-- image) with the cosine operator class: the v1 embedder emits L2-normalized
-- vectors, so cosine distance is the correct similarity metric and matches how
-- retrieval ranks results. NULL embeddings (documents created but not yet
-- ingested) are simply not indexed.
--
-- Rollback: drop index kb_chunks_embedding_hnsw_idx;

create index if not exists kb_chunks_embedding_hnsw_idx
  on kb_chunks using hnsw (embedding vector_cosine_ops);
