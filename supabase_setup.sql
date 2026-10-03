-- Run this once in Supabase: SQL Editor > New query > paste > Run.
create table if not exists pehli_plans (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  visitor_id        text not null,        -- random id made in the browser; no name, email or IP
  input             jsonb not null,       -- the visitor's figures and optional note
  output            text not null,        -- the plan Gemini wrote
  input_tokens      integer,
  output_tokens     integer,
  model             text,
  safe_per_day      integer,
  identified_saving integer               -- rupees per month found by Two Cuts
);

create index if not exists pehli_plans_visitor_idx on pehli_plans (visitor_id, created_at);

-- Row Level Security on, with no policies: the table can only be read or written
-- by the serverless function, which holds the secret key.
alter table pehli_plans enable row level security;
