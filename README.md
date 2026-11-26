# CliniSkills

CliniSkills is a React + TypeScript + Supabase web application for nursing clinical and practical procedure assessments.

## Included
- Admin and examiner role-based workspaces.
- Programme management with RGN, RM, PHN and NAP seeded in SQL.
- Student register with programme, cohort and level.
- CSV / XLSX / XLS procedure manual import, preview, validation and template download.
- Step scoring, critical-step flag, automatic percentage and grade.
- Assessment history and PDF, Excel and CSV exports.
- Supabase Row Level Security policies.

## Tech stack
- Frontend: React, TypeScript and Vite.
- Backend/database/auth: Supabase (PostgreSQL + Supabase Auth + RLS).
- Excel parsing/export: SheetJS (`xlsx`).
- CSV parsing: Papa Parse.
- PDF: jsPDF + jsPDF-AutoTable.

## Setup

1. Create a Supabase project.
2. Open Supabase **SQL Editor**, paste and run all of `supabase/schema.sql`.
3. In Supabase **Authentication > Users**, create the first administrator account. Disable public sign-ups if only admins should provision accounts.
4. Copy the new user's UUID. In SQL Editor, run (replace the values):
   ```sql
   insert into public.profiles (id, full_name, role)
   values ('PASTE_AUTH_USER_UUID_HERE', 'Administrator Name', 'admin');
   ```
5. Create examiner accounts in Authentication > Users, then insert a profile for each:
   ```sql
   insert into public.profiles (id, full_name, role)
   values ('EXAMINER_AUTH_UUID', 'Examiner Full Name', 'examiner');
   ```
6. Copy `.env.example` to `.env`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase Project Settings > API. Use the publishable/anon key only.
7. Install and run:
   ```bash
   npm install
   npm run dev
   ```
8. For production build:
   ```bash
   npm run build
   ```

## GitHub / Vercel deployment
- Upload the project folder contents to a GitHub repository.
- In Vercel, import that repository. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Vercel Environment Variables, then redeploy.
- Do not commit `.env` and never add the Supabase service-role key to frontend environment variables.

## Procedure import columns

Every row is one procedure step. Required columns:
`program_code, procedure_code, procedure_title, step_no, step_description, max_score, critical, pass_mark`

- `program_code`: must already exist, e.g. RGN.
- `procedure_code`: stable code for that programme.
- `procedure_title`: same for all rows in the same procedure.
- `step_no`: positive integer, unique within the procedure.
- `step_description`: criterion/step text.
- `max_score`: maximum points for that step (e.g. 4).
- `critical`: `true` or `false`.
- `pass_mark`: percentage, defaults to 60 when blank.

The template is provided as `IMPORT_TEMPLATE.csv`; the app also downloads an `.xlsx` template.

## Grading
- Below 60%: Fail
- 60% to below 70%: Pass
- 70% to below 80%: Credit
- 80% to 100%: Distinction

A zero score on a critical step causes the assessment status to be Fail, even if the overall percentage is at least 60%. The grade label still reflects the numeric percentage.

## Important limitations / production hardening
- This starter is a working foundation, not a fully audited clinical examination system.
- Examiner and student account creation is intentionally performed through Supabase Auth administration, then linked to a profile. Do not expose service-role credentials in the browser. For a production workflow, add a protected Supabase Edge Function for admin-only account provisioning.
- Assessment records are inserted before their step-score rows. For strict all-or-nothing transactional submissions, replace the two client writes with a PostgreSQL RPC function and submit through that function.
- The PDF export currently provides a clean summary report. Extend it to include the detailed step-by-step scores by fetching `assessment_scores` for the selected assessment.
- Review local institutional policy before using this system for official high-stakes examinations. Back up data and test RLS with separate admin and examiner accounts.

## Folder structure
```
cliniskills/
  src/
    App.tsx
    lib.ts
    main.tsx
    styles.css
  supabase/
    schema.sql
  IMPORT_TEMPLATE.csv
  .env.example
  package.json
  README.md
```
