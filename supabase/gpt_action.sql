create table if not exists public.market_mappings (
    sport text not null default 'mlb',
    stake_display_name text not null,
    internal_market_key text not null,
    stat_key text,
    group_name text,
    last_seen_at timestamptz not null,
    active boolean not null default true,
    examples jsonb not null default '[]'::jsonb,
    primary key (sport, stake_display_name, internal_market_key)
);

alter table public.market_mappings enable row level security;

create index if not exists market_mappings_active_idx
    on public.market_mappings (sport, active);

create table if not exists public.local_ui_jobs (
    job_id text primary key,
    job_type text not null,
    status text not null default 'pending',
    request_json jsonb not null default '{}'::jsonb,
    result_json jsonb,
    error_message text,
    worker_id text,
    created_at timestamptz not null default now(),
    claimed_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz not null default now(),
    expires_at timestamptz
);

alter table public.local_ui_jobs enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.market_mappings to service_role;
grant select, insert, update, delete on public.local_ui_jobs to service_role;

create index if not exists local_ui_jobs_pending_idx
    on public.local_ui_jobs (job_type, status, created_at);

create index if not exists local_ui_jobs_expires_idx
    on public.local_ui_jobs (expires_at);

create index if not exists local_ui_jobs_worker_idx
    on public.local_ui_jobs (worker_id, status, claimed_at);

notify pgrst, 'reload schema';
