-- Euthyna schema (Supabase / Postgres 15+). The chain is the source of truth; these tables mirror it
-- for speed and hold what the chain cannot (decision records, invoice metadata, expected inflows).
-- Idempotent: safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_address text not null,
  contact       text,
  created_at    timestamptz not null default now()
);

-- Circle dev-controlled SCA wallets created for agents, before and after they are bound to a vault.
create table if not exists agent_wallets (
  wallet_id   text primary key,
  address     text not null unique,
  blockchain  text not null default 'ARC-TESTNET',
  vault_id    uuid,
  created_at  timestamptz not null default now()
);

create table if not exists vaults (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid references businesses(id),
  address            text not null unique,           -- lowercase
  owner_address      text not null,
  agent_wallet_id    text,                            -- null when EXECUTOR=local
  agent_address      text not null,
  reserve_mode       text not null default 'INTERNAL' check (reserve_mode in ('USYC', 'INTERNAL')),
  created_block      bigint not null default 0,
  last_indexed_block bigint not null default 0,
  active             boolean not null default true,
  is_test            boolean not null default false,  -- label demo/test vaults honestly
  created_at         timestamptz not null default now()
);

create table if not exists payees (
  vault_id        uuid not null references vaults(id),
  address         text not null,
  display_name    text,
  aliases         text[] not null default '{}',
  max_per_invoice numeric(24,6),
  max_per_month   numeric(24,6),
  active_at       timestamptz,
  allowed         boolean not null default true,
  primary key (vault_id, address)
);

create table if not exists obligations (
  vault_id             uuid not null references vaults(id),
  chain_id             integer not null,
  ref                  text not null,
  payee                text not null,
  amount               numeric(24,6) not null,
  due_at               timestamptz not null,
  source               text not null check (source in ('OWNER', 'AGENT')),
  status               text not null check (status in ('PENDING', 'ESCALATED', 'PAID', 'CANCELLED')),
  escalated            boolean not null default false,
  failed_for_liquidity boolean not null default false,
  paid_at              timestamptz,
  invoice_number       text,
  note                 text,
  invoice_file_url     text,
  extracted_json       jsonb,
  updated_at           timestamptz not null default now(),
  primary key (vault_id, chain_id),
  unique (vault_id, ref)
);

create table if not exists expected_inflows (
  id          uuid primary key default gen_random_uuid(),
  vault_id    uuid not null references vaults(id),
  from_name   text not null,
  amount      numeric(24,6) not null check (amount > 0),
  expected_at timestamptz not null,
  confidence  numeric(3,2) not null check (confidence in (0.5, 0.8, 0.95)),
  received_at timestamptz,
  created_at  timestamptz not null default now()
);

-- One row per agent run. canonical_json is the exact byte string that was hashed into decision_hash.
create table if not exists decisions (
  id             uuid primary key default gen_random_uuid(),
  vault_id       uuid not null references vaults(id),
  trigger        text not null,
  snapshot       jsonb not null,
  precomputed    jsonb not null,
  llm_output     jsonb,
  policy_result  jsonb not null,
  model          text not null,           -- model requested
  model_served   text,                    -- model that actually answered (may differ on fallback)
  prompt_version text not null,
  canonical_json text not null,
  decision_hash  text not null unique,
  status         text not null default 'RECORDED'
                   check (status in ('RECORDED', 'EXECUTING', 'CONFIRMED', 'PARTIAL', 'FAILED', 'HOLD')),
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists decisions_vault_created on decisions (vault_id, created_at desc);

-- One row per on-chain call a decision makes (a decision can pay two bills and sweep).
create table if not exists decision_actions (
  id               uuid primary key default gen_random_uuid(),
  decision_id      uuid not null references decisions(id),
  idx              integer not null,
  type             text not null,
  params           jsonb not null,
  idempotency_key  uuid not null unique,
  circle_tx_id     text,
  tx_hash          text,
  status           text not null default 'PENDING'
                     check (status in ('PENDING', 'SIMULATION_FAILED', 'SENT', 'CONFIRMED', 'FAILED', 'SKIPPED')),
  error            text,
  updated_at       timestamptz not null default now(),
  unique (decision_id, idx)
);
create index if not exists decision_actions_status on decision_actions (status);

create table if not exists commitments (
  vault_id        uuid not null references vaults(id),
  chain_id        integer not null,
  amount          numeric(24,6) not null,
  remaining       numeric(24,6) not null,
  opened_at       timestamptz not null,
  t               timestamptz not null,
  cover_to        integer not null,
  limit_at_open   numeric(24,6) not null,
  capital_usdc_days numeric(24,6) not null default 0,  -- USDC x days actually held in reserve
  decision_hash   text,
  decision_id     uuid references decisions(id),
  settled         boolean not null default false,
  hit             boolean,
  credit          numeric(24,6),
  score_after     numeric(24,6),
  limit_after     numeric(24,6),
  settled_at      timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (vault_id, chain_id)
);

create table if not exists chain_events (
  vault_id   uuid references vaults(id),
  address    text not null,
  tx_hash    text not null,
  log_index  integer not null,
  block      bigint not null,
  name       text not null,
  args       jsonb not null,
  block_time timestamptz not null,
  primary key (tx_hash, log_index)
);
create index if not exists chain_events_vault_name on chain_events (vault_id, name, block);

-- Things the agent could not do and an owner should look at (blocklisted payee, simulation revert, ...).
create table if not exists owner_alerts (
  id          uuid primary key default gen_random_uuid(),
  vault_id    uuid not null references vaults(id),
  kind        text not null,
  message     text not null,
  data        jsonb,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists worker_state (
  key   text primary key,
  value jsonb not null
);
