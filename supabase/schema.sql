-- CliniSkills database schema for Supabase PostgreSQL.
-- Run this entire file in Supabase SQL Editor using the project owner account.
-- Do not expose the service_role key in the browser.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'examiner' check (role in ('admin','examiner')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_number text not null unique,
  full_name text not null,
  program_id uuid not null references public.programs(id),
  cohort text,
  level text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id),
  code text not null,
  title text not null,
  pass_mark numeric(5,2) not null default 60 check (pass_mark between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(program_id,code)
);

create table if not exists public.procedure_steps (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures(id) on delete cascade,
  step_no integer not null check (step_no > 0),
  description text not null,
  max_score numeric(8,2) not null check (max_score > 0),
  is_critical boolean not null default false,
  created_at timestamptz not null default now(),
  unique(procedure_id,step_no)
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  program_id uuid not null references public.programs(id),
  procedure_id uuid not null references public.procedures(id),
  examiner_id uuid not null references public.profiles(id),
  total_score numeric(10,2) not null,
  max_score numeric(10,2) not null check (max_score > 0),
  percentage numeric(6,2) not null check (percentage between 0 and 100),
  grade text not null check (grade in ('Fail','Pass','Credit','Distinction')),
  status text not null check (status in ('Pass','Fail')),
  remarks text,
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_scores (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  step_id uuid not null references public.procedure_steps(id),
  score numeric(8,2) not null check (score >= 0),
  unique(assessment_id,step_id)
);

create index if not exists idx_students_program on public.students(program_id);
create index if not exists idx_procedures_program on public.procedures(program_id);
create index if not exists idx_assessments_examiner on public.assessments(examiner_id);
create index if not exists idx_assessments_student on public.assessments(student_id);
create index if not exists idx_assessments_created on public.assessments(created_at desc);

-- Role helper. SECURITY DEFINER avoids recursive RLS checks on profiles.
create or replace function public.current_user_role()
returns text language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.students enable row level security;
alter table public.procedures enable row level security;
alter table public.procedure_steps enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_scores enable row level security;

-- Profiles: users can view their own profile; admins can view/manage all profiles.
drop policy if exists "profile self or admin read" on public.profiles;
create policy "profile self or admin read" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());
drop policy if exists "admin manage profiles" on public.profiles;
create policy "admin manage profiles" on public.profiles for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Programs: authenticated staff can read; only admins can write.
drop policy if exists "staff read programs" on public.programs;
create policy "staff read programs" on public.programs for select to authenticated using (public.current_user_role() in ('admin','examiner'));
drop policy if exists "admin manage programs" on public.programs;
create policy "admin manage programs" on public.programs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Students: staff can read; admin can manage. Examiner access is read-only.
drop policy if exists "staff read students" on public.students;
create policy "staff read students" on public.students for select to authenticated using (public.current_user_role() in ('admin','examiner'));
drop policy if exists "admin manage students" on public.students;
create policy "admin manage students" on public.students for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Procedures and steps: staff read; admin writes.
drop policy if exists "staff read procedures" on public.procedures;
create policy "staff read procedures" on public.procedures for select to authenticated using (public.current_user_role() in ('admin','examiner'));
drop policy if exists "admin manage procedures" on public.procedures;
create policy "admin manage procedures" on public.procedures for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "staff read procedure steps" on public.procedure_steps;
create policy "staff read procedure steps" on public.procedure_steps for select to authenticated using (public.current_user_role() in ('admin','examiner'));
drop policy if exists "admin manage procedure steps" on public.procedure_steps;
create policy "admin manage procedure steps" on public.procedure_steps for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Assessments: admins see all; examiners see and create only their own.
drop policy if exists "read own or admin assessments" on public.assessments;
create policy "read own or admin assessments" on public.assessments for select to authenticated
using (public.is_admin() or examiner_id = auth.uid());
drop policy if exists "examiner create own assessment" on public.assessments;
create policy "examiner create own assessment" on public.assessments for insert to authenticated
with check (examiner_id = auth.uid() and public.current_user_role() in ('admin','examiner')
  and exists(select 1 from public.students s where s.id=assessments.student_id and s.program_id=assessments.program_id)
  and exists(select 1 from public.procedures p where p.id=assessments.procedure_id and p.program_id=assessments.program_id));
drop policy if exists "admin update assessments" on public.assessments;
create policy "admin update assessments" on public.assessments for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete assessments" on public.assessments;
create policy "admin delete assessments" on public.assessments for delete to authenticated using (public.is_admin());

drop policy if exists "read assessment score rows" on public.assessment_scores;
create policy "read assessment score rows" on public.assessment_scores for select to authenticated
using (exists(select 1 from public.assessments a where a.id=assessment_id and (a.examiner_id=auth.uid() or public.is_admin())));
drop policy if exists "insert own assessment score rows" on public.assessment_scores;
create policy "insert own assessment score rows" on public.assessment_scores for insert to authenticated
with check (exists(select 1 from public.assessments a where a.id=assessment_id and (a.examiner_id=auth.uid() or public.is_admin())));
drop policy if exists "admin manage assessment score rows" on public.assessment_scores;
create policy "admin manage assessment score rows" on public.assessment_scores for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Default programme records.
insert into public.programs(code,name) values
('RGN','Registered General Nursing'),
('RM','Registered Midwifery'),
('PHN','Public Health Nursing'),
('NAP','Nursing Assistant Preventive')
on conflict(code) do nothing;

-- IMPORTANT FIRST-ADMIN SETUP:
-- 1. Create the first user in Supabase Authentication > Users.
-- 2. Run the statement below after replacing the UUID and name:
-- insert into public.profiles(id,full_name,role) values ('AUTH_USER_UUID','Administrator Name','admin');
-- For each examiner account, create the Auth user, then insert a profile with role='examiner'.
-- Never allow public sign-up to assign an admin role.
