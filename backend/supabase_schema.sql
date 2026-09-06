-- ============================================================================
-- NARCHI — Supabase schema (run this in Supabase SQL Editor)
-- Enables true cross-device collaboration: auth, chat, mood, plan review.
-- After running, create the app: paste your Project URL + anon key in
-- Narchi → Réglages → Backend (or /app/backend).
-- ============================================================================

-- 1. USERS (profiles synced with Supabase Auth)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null,
  role text not null default 'architect',  -- 'owner' | 'architect'
  company text,
  status text not null default 'active',    -- 'active' | 'disabled'
  note text,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

-- 2. CHAT CHANNELS
create table if not exists public.chat_channels (
  id text primary key,
  kind text not null,           -- 'team' | 'project' | 'direct'
  name text not null,
  member_ids text[] not null default '{}',
  project_id text,
  created_at timestamptz not null default now()
);

-- 3. CHAT MESSAGES
create table if not exists public.chat_messages (
  id text primary key,
  channel_id text not null,
  author_id text not null,
  author_name text not null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_channel on public.chat_messages(channel_id, created_at);

-- 4. MOOD CHECK-INS
create table if not exists public.mood_checkins (
  id text primary key,
  user_id text not null,
  user_name text not null,
  level int not null,           -- 1..5
  emoji text not null,
  energy int not null,
  stress int not null,
  workload int not null,
  note text,
  date date not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_mood_user_date on public.mood_checkins(user_id, date);

-- 5. PLAN REVIEW PINS
create table if not exists public.plan_pins (
  id text primary key,
  sheet_id text not null,
  x float not null,
  y float not null,
  severity text not null,
  status text not null default 'offen',
  author_id text not null,
  author_name text not null,
  category text,
  comment text not null,
  assignee text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- 6. FEEDBACK
create table if not exists public.feedback (
  id text primary key,
  user_id text not null,
  user_name text not null,
  rating int not null,
  category text not null,
  page text,
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY: authenticated users can read/write team data.
-- For a single-office deployment this permissive policy is appropriate.
-- Tighten per-tenant if you go multi-office.
-- ----------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;
alter table public.mood_checkins enable row level security;
alter table public.plan_pins enable row level security;
alter table public.feedback enable row level security;

create policy "read_all" on public.users for select using (auth.role() = 'authenticated');
create policy "write_all" on public.users for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "read_msgs" on public.chat_channels for select using (auth.role() = 'authenticated');
create policy "write_msgs" on public.chat_channels for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "read_chat" on public.chat_messages for select using (auth.role() = 'authenticated');
create policy "write_chat" on public.chat_messages for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "read_mood" on public.mood_checkins for select using (auth.role() = 'authenticated');
create policy "write_mood" on public.mood_checkins for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "read_pins" on public.plan_pins for select using (auth.role() = 'authenticated');
create policy "write_pins" on public.plan_pins for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "read_fb" on public.feedback for select using (auth.role() = 'authenticated');
create policy "write_fb" on public.feedback for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
