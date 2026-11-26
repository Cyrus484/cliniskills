import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_'));
export const supabase = configured ? createClient(url!, key!) : null;

export type Profile = { id: string; full_name: string; role: 'admin'|'examiner'; is_active: boolean };
export type Program = { id: string; code: string; name: string; is_active: boolean };
export type Student = { id: string; student_number: string; full_name: string; program_id: string; cohort: string|null; level: string|null; is_active: boolean };
export type Procedure = { id: string; code: string; title: string; program_id: string; pass_mark: number; is_active: boolean; steps?: Step[] };
export type Step = { id?: string; step_no: number; description: string; max_score: number; is_critical: boolean };
export type Assessment = {
  id: string; student_id: string; program_id: string; procedure_id: string; examiner_id: string;
  total_score: number; max_score: number; percentage: number; grade: string; status: string;
  remarks: string|null; created_at: string; student?: Student; program?: Program; procedure?: Procedure; examiner?: Profile;
};
export function gradeFor(pct: number) {
  if (pct < 60) return 'Fail';
  if (pct < 70) return 'Pass';
  if (pct < 80) return 'Credit';
  return 'Distinction';
}
