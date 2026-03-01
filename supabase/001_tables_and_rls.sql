-- TABLES

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  display_name text,
  onboarding_completed boolean not null default false
);

create table public.preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  likes_genres text[] default '{}',
  dislikes_genres text[] default '{}',
  updated_at timestamptz not null default now()
);

create table public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  query_text text not null,
  filters jsonb default '{}'::jsonb,
  results jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.book_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id text not null,
  title text not null,
  author text not null,
  cover_url text,
  interaction_type text not null check (interaction_type in ('click','like','dislike','save')),
  created_at timestamptz not null default now()
);

-- INDEXES

create index idx_search_history_user on public.search_history(user_id, created_at desc);
create index idx_book_interactions_user on public.book_interactions(user_id, created_at desc);
create index idx_book_interactions_book on public.book_interactions(user_id, book_id);

-- AUTO-CREATE PROFILE + PREFERENCES ON SIGNUP

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
    values (new.id)
    on conflict (id) do nothing;
  insert into public.preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- MERGE FUNCTION (for guest -> existing-account migration)

create or replace function public.merge_anonymous_user(
  old_uid uuid,
  new_uid uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Guard: no-op if same user
  if old_uid = new_uid then
    return;
  end if;

  -- Move search history
  update public.search_history
    set user_id = new_uid
    where user_id = old_uid;

  -- Move book interactions
  update public.book_interactions
    set user_id = new_uid
    where user_id = old_uid;

  -- Merge preferences (union genres, deduplicate, coalesce for nulls)
  update public.preferences set
    likes_genres = coalesce((
      select array_agg(distinct g)
      from (
        select unnest(coalesce(likes_genres, '{}')) as g from public.preferences where user_id = new_uid
        union
        select unnest(coalesce(likes_genres, '{}')) from public.preferences where user_id = old_uid
      ) sub
    ), '{}'),
    dislikes_genres = coalesce((
      select array_agg(distinct g)
      from (
        select unnest(coalesce(dislikes_genres, '{}')) as g from public.preferences where user_id = new_uid
        union
        select unnest(coalesce(dislikes_genres, '{}')) from public.preferences where user_id = old_uid
      ) sub
    ), '{}'),
    updated_at = now()
  where user_id = new_uid;

  -- Clean up old user's preferences and profile (idempotent)
  delete from public.preferences where user_id = old_uid;
  delete from public.profiles where id = old_uid;
end;
$$;

-- RLS

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.search_history enable row level security;
alter table public.book_interactions enable row level security;

create policy "select own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "select own preferences" on public.preferences
  for select using (auth.uid() = user_id);
create policy "update own preferences" on public.preferences
  for update using (auth.uid() = user_id);

create policy "select own searches" on public.search_history
  for select using (auth.uid() = user_id);
create policy "insert own searches" on public.search_history
  for insert with check (auth.uid() = user_id);
create policy "update own searches" on public.search_history
  for update using (auth.uid() = user_id);

create policy "select own interactions" on public.book_interactions
  for select using (auth.uid() = user_id);
create policy "insert own interactions" on public.book_interactions
  for insert with check (auth.uid() = user_id);
