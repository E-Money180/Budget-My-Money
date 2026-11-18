-- Budget My Money database schema

create extension if not exists pgcrypto;

create table if not exists public.bills (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,

  amount numeric(12,2) not null check(amount>=0),

  due_date date,

  category text not null default 'Other',

  frequency text not null default 'monthly' check(frequency in ('weekly','biweekly','monthly','quarterly','yearly','once')),

  paid boolean not null default false,

  created_at timestamptz not null default now()

);

create table if not exists public.income (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  source text not null,

  amount numeric(12,2) not null check(amount>=0),

  frequency text not null check(frequency in ('weekly','biweekly','twice_monthly','monthly')),

  next_payday date,

  created_at timestamptz not null default now()

);

create table if not exists public.transactions (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  description text not null,

  amount numeric(12,2) not null check(amount>=0),

  date date not null default current_date,

  kind text not null check(kind in ('income','expense')),

  category text not null default 'Other',

  source text not null default 'manual',

  plaid_transaction_id text,

  created_at timestamptz not null default now(),

  unique(user_id,plaid_transaction_id)

);

create table if not exists public.goals (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,

  target_amount numeric(12,2) not null default 0,

  current_amount numeric(12,2) not null default 0,

  monthly_contribution numeric(12,2) not null default 0,

  monthly_budget numeric(12,2) not null default 0,

  goal_type text not null default 'savings' check(goal_type in ('savings','spending')),

  created_at timestamptz not null default now()

);

create table if not exists public.bank_items (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  plaid_item_id text not null unique,

  institution_name text,

  access_token_encrypted text not null,

  created_at timestamptz not null default now()

);

create table if not exists public.bank_accounts (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  plaid_account_id text not null unique,

  institution_name text,

  account_name text,

  account_mask text,

  account_type text,

  current_balance numeric(12,2),

  updated_at timestamptz default now()

);

alter table public.bills enable row level security;

alter table public.income enable row level security;

alter table public.transactions enable row level security;

alter table public.goals enable row level security;

alter table public.bank_items enable row level security;

alter table public.bank_accounts enable row level security;

do $$ declare t text; begin

  foreach t in array array['bills','income','transactions','goals','bank_accounts'] loop

    execute format('drop policy if exists "Users manage own %1$s" on public.%1$I',t);

    execute format('create policy "Users manage own %1$s" on public.%1$I for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id)',t);

  end loop;

end $$;

-- Bank tokens must not be exposed to the browser.

revoke all on public.bank_items from anon, authenticated;
