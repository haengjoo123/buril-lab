create table if not exists public.ai_api_cache (
  id uuid primary key default gen_random_uuid(),
  api_type text not null,
  cache_key text not null,
  response_data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.ai_api_cache
  add column if not exists api_type text,
  add column if not exists cache_key text,
  add column if not exists response_data jsonb,
  add column if not exists created_at timestamptz default now();

create index if not exists ai_api_cache_lookup_idx
  on public.ai_api_cache (api_type, cache_key);

alter table public.ai_api_cache enable row level security;
