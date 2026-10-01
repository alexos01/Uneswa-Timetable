-- Reconstruction of the live schema before migration 001, with the original
-- style of policies: anyone reads, any signed-in user writes.
create table public.faculties (id uuid primary key default gen_random_uuid(), name text not null);
create table public.programmes (id uuid primary key default gen_random_uuid(), name text not null,
  faculty_id uuid references public.faculties(id) on delete set null);
create table public.modules (id uuid primary key default gen_random_uuid(), code text not null, day text,
  start_time text, end_time text, venue text, programme_id uuid references public.programmes(id) on delete cascade);
create table public.exams (id uuid primary key default gen_random_uuid(), code text not null, exam_date date,
  start_time text, end_time text, venue text, programme_id uuid references public.programmes(id) on delete cascade);
create table public.settings (id int primary key, semester text, semester_version int default 1, updated_at timestamptz default now());
create table public.students (id text primary key, name text, programme_id uuid, module_ids uuid[] default '{}',
  semester_version int default 1, updated_at timestamptz default now(), history jsonb default '[]');

alter publication supabase_realtime add table public.faculties, public.programmes, public.modules, public.exams, public.settings;

do $$ declare t text; begin
  foreach t in array array['faculties','programmes','modules','exams','settings','students'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "Public read %s" on public.%I for select using (true)', t, t);
    execute format('create policy "Admin write %s" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;
create policy "Anyone registers" on public.students for insert to anon with check (true);
create policy "Anyone updates" on public.students for update to anon using (true);

insert into public.settings values (1, 'Semester 1 2026/2027', 3, '2026-09-17');
insert into public.faculties (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Faculty of Science and Engineering');
insert into public.programmes (id, name, faculty_id) values ('00000000-0000-0000-0000-0000000000a1', 'B.Sc. Computer Science', '00000000-0000-0000-0000-0000000000f1');
insert into public.modules (code, day, start_time, end_time, venue, programme_id) values
  ('CSC111', 'Monday', '08:00', '08:50', 'SC.LEC.TH.I', '00000000-0000-0000-0000-0000000000a1'),
  ('MAT111', 'Tuesday', '09:00', '09:50', 'MPH', '00000000-0000-0000-0000-0000000000a1');
insert into public.students (id, name) values ('202100123', 'Existing Student');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@uneswa.test');
