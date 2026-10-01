-- 002_announcements_and_notices.sql
-- Announcements (admins) and class notices such as tests or cancellations
-- (lecturers and admins). Requires 001_campuses_and_roles.sql.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again.

begin;

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  campus_id   text references public.campuses(id) on delete cascade, -- null = every campus
  title       text not null check (char_length(title) between 1 and 140),
  body        text not null default '' check (char_length(body) <= 4000),
  pinned      boolean not null default false,
  author_name text,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz
);
create index if not exists announcements_campus_idx on public.announcements (campus_id, created_at desc);

create table if not exists public.class_notices (
  id          uuid primary key default gen_random_uuid(),
  campus_id   text not null references public.campuses(id) on delete cascade,
  code        text not null,
  kind        text not null check (kind in ('test', 'cancelled', 'moved', 'extra', 'note')),
  notice_date date not null,
  start_time  text,
  end_time    text,
  venue       text,
  title       text check (char_length(title) <= 140),
  details     text check (char_length(details) <= 2000),
  author_name text,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists class_notices_lookup_idx on public.class_notices (campus_id, code, notice_date);

alter table public.announcements enable row level security;
alter table public.class_notices enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('announcements', 'class_notices')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "announcements: read" on public.announcements for select using (true);
-- All-campus posts (campus_id null) are for super admins only.
create policy "announcements: admin writes" on public.announcements for all
  using (case when campus_id is null then public.is_super_admin() else public.is_campus_admin(campus_id) end)
  with check (case when campus_id is null then public.is_super_admin() else public.is_campus_admin(campus_id) end);

create policy "class_notices: read" on public.class_notices for select using (true);
create policy "class_notices: admin or lecturer writes" on public.class_notices for all
  using (public.is_campus_admin(campus_id) or public.teaches(campus_id, code))
  with check (public.is_campus_admin(campus_id) or public.teaches(campus_id, code));

grant select on public.announcements, public.class_notices to anon, authenticated;
grant insert, update, delete on public.announcements, public.class_notices to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['announcements', 'class_notices'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;
