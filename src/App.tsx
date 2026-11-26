import { useEffect, useMemo, useState } from 'react';
import { supabase, configured, gradeFor, type Profile, type Program, type Student, type Procedure, type Step, type Assessment } from './lib';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Activity, BookOpen, ClipboardCheck, Download, FileSpreadsheet, LogOut, Plus, ShieldCheck, Users } from 'lucide-react';

type Tab = 'overview'|'programs'|'manuals'|'students'|'assessment'|'results';
type ManualRow = { program_code:string; procedure_code:string; procedure_title:string; step_no:number; step_description:string; max_score:number; critical:boolean; pass_mark:number };
const starterPrograms = ['RGN','RM','PHN','NAP'];

export default function App() {
  const [sessionUser,setSessionUser] = useState<any>(null);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [tab,setTab] = useState<Tab>('overview');
  const [programs,setPrograms] = useState<Program[]>([]);
  const [students,setStudents] = useState<Student[]>([]);
  const [procedures,setProcedures] = useState<Procedure[]>([]);
  const [assessments,setAssessments] = useState<Assessment[]>([]);
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [uploadRows,setUploadRows] = useState<ManualRow[]>([]);
  const [uploadErrors,setUploadErrors] = useState<string[]>([]);
  const [newProgram,setNewProgram] = useState({code:'',name:''});
  const [newStudent,setNewStudent] = useState({student_number:'',full_name:'',program_id:'',cohort:'',level:''});
  const [selectedProgram,setSelectedProgram] = useState('');
  const [selectedStudent,setSelectedStudent] = useState('');
  const [selectedProcedure,setSelectedProcedure] = useState('');
  const [scores,setScores] = useState<Record<string,number>>({});
  const [remarks,setRemarks] = useState('');

  const activeProcedure = procedures.find(p=>p.id===selectedProcedure);
  const activeSteps = activeProcedure?.steps || [];
  const maxScore = activeSteps.reduce((n,s)=>n+Number(s.max_score),0);
  const totalScore = activeSteps.reduce((n,s)=>n+Number(scores[s.id || String(s.step_no)] || 0),0);
  const percentage = maxScore ? totalScore/maxScore*100 : 0;

  async function loadAll(uid?:string) {
    if (!supabase) return;
    const [p,s,pr,a] = await Promise.all([
      supabase.from('programs').select('*').order('code'),
      supabase.from('students').select('*').order('full_name'),
      supabase.from('procedures').select('*, procedure_steps(*)').eq('is_active',true).order('title'),
      supabase.from('assessments').select('*, students(*), programs(*), procedures(*), profiles:examiner_id(*)').order('created_at',{ascending:false}).limit(500)
    ]);
    if (p.error || s.error || pr.error || a.error) { setNotice([p.error,s.error,pr.error,a.error].find(Boolean)?.message || 'Unable to load records.'); return; }
    setPrograms(p.data || []); setStudents(s.data || []);
    setProcedures((pr.data || []).map((x:any)=>({...x,steps:(x.procedure_steps||[]).sort((a:any,b:any)=>a.step_no-b.step_no)})));
    setAssessments((a.data || []).map((x:any)=>({...x,student:x.students,program:x.programs,procedure:x.procedures,examiner:x.profiles})));
  }

  useEffect(()=>{
    if (!supabase) return;
    supabase.auth.getSession().then(async ({data})=>{
      if (data.session) { setSessionUser(data.session.user); await loadProfile(data.session.user.id); }
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,session)=>{
      setSessionUser(session?.user || null);
      if (!session) setProfile(null);
      else setTimeout(()=>loadProfile(session.user.id),0);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  async function loadProfile(uid:string) {
    if (!supabase) return;
    const {data,error} = await supabase.from('profiles').select('*').eq('id',uid).single();
    if (error) { setNotice('Your account profile was not found. Ask the administrator to create or activate your profile.'); return; }
    if (!data.is_active) { await supabase.auth.signOut(); setNotice('This account is inactive. Contact the administrator.'); return; }
    setProfile(data); await loadAll(uid);
  }

  async function signIn(e:React.FormEvent) {
    e.preventDefault(); if (!supabase) return;
    setBusy(true); setNotice('');
    const {error} = await supabase.auth.signInWithPassword({email,password});
    if (error) setNotice(error.message);
    setBusy(false);
  }
  async function signOut(){ await supabase?.auth.signOut(); setSessionUser(null); setProfile(null); }

  async function addProgram(e:React.FormEvent) {
    e.preventDefault(); if(!supabase) return;
    const {error}=await supabase.from('programs').insert({code:newProgram.code.trim().toUpperCase(),name:newProgram.name.trim()});
    setNotice(error?.message || 'Program saved.'); if(!error){setNewProgram({code:'',name:''});loadAll();}
  }
  async function toggleProgram(p:Program) {
    const {error}=await supabase!.from('programs').update({is_active:!p.is_active}).eq('id',p.id);
    setNotice(error?.message || 'Program updated.'); if(!error)loadAll();
  }
  async function addStudent(e:React.FormEvent) {
    e.preventDefault(); if(!supabase)return;
    const {error}=await supabase.from('students').insert({...newStudent,cohort:newStudent.cohort||null,level:newStudent.level||null});
    setNotice(error?.message || 'Student saved.'); if(!error){setNewStudent({student_number:'',full_name:'',program_id:'',cohort:'',level:''});loadAll();}
  }

  async function parseManual(file:File) {
    setUploadErrors([]); setUploadRows([]);
    const ext=file.name.toLowerCase().split('.').pop();
    try {
      let raw:any[]=[];
      if(ext==='csv') {
        const text=await file.text();
        const parsed=Papa.parse(text,{header:true,skipEmptyLines:true,dynamicTyping:true});
        if(parsed.errors.length) setUploadErrors(parsed.errors.map(x=>`CSV row ${(x.row ?? 0)+2}: ${x.message}`));
        raw=parsed.data as any[];
      } else if(ext==='xlsx'||ext==='xls') {
        const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
        raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
      } else { setUploadErrors(['Only .csv, .xlsx and .xls files are supported.']); return; }
      const rows:ManualRow[]=[];
      raw.forEach((r:any,i)=>{
        const rowNo=i+2;
        const program_code=String(r.program_code||'').trim().toUpperCase();
        const procedure_code=String(r.procedure_code||'').trim();
        const procedure_title=String(r.procedure_title||'').trim();
        const step_no=Number(r.step_no);
        const step_description=String(r.step_description||'').trim();
        const max_score=Number(r.max_score);
        const critical=String(r.critical).toLowerCase()==='true'||String(r.critical)==='1'||r.critical===true;
        const pass_mark=Number(r.pass_mark||60);
        const programExists=programs.some(p=>p.code===program_code);
        if(!programExists) setUploadErrors(old=>[...old,`Row ${rowNo}: unknown program_code "${program_code}". Create the program first.`]);
        if(!procedure_code||!procedure_title||!step_description||!Number.isInteger(step_no)||step_no<1||!Number.isFinite(max_score)||max_score<=0||!Number.isFinite(pass_mark)||pass_mark<0||pass_mark>100)
          setUploadErrors(old=>[...old,`Row ${rowNo}: check procedure_code, procedure_title, step_no, step_description, max_score and pass_mark.`]);
        rows.push({program_code,procedure_code,procedure_title,step_no,step_description,max_score,critical,pass_mark});
      });
      setUploadRows(rows);
      if(!rows.length) setUploadErrors(['No data rows found in the selected file.']);
    } catch { setUploadErrors(['The file could not be read. Check that it is a valid CSV or Excel workbook.']); }
  }

  async function saveManual() {
    if(!supabase||!uploadRows.length||uploadErrors.length)return;
    setBusy(true); setNotice('');
    const grouped=new Map<string,ManualRow[]>();
    uploadRows.forEach(r=>{const key=`${r.program_code}::${r.procedure_code}`;grouped.set(key,[...(grouped.get(key)||[]),r]);});
    for(const rows of grouped.values()){
      const first=rows[0], program=programs.find(p=>p.code===first.program_code);
      if(!program)continue;
      const {data:proc,error}=await supabase.from('procedures').upsert({
        program_id:program.id,code:first.procedure_code,title:first.procedure_title,pass_mark:first.pass_mark,is_active:true
      },{onConflict:'program_id,code'}).select().single();
      if(error){setNotice(error.message);setBusy(false);return;}
      const {error:delError}=await supabase.from('procedure_steps').delete().eq('procedure_id',proc.id);
      if(delError){setNotice(delError.message);setBusy(false);return;}
      const {error:stepError}=await supabase.from('procedure_steps').insert(rows.map(r=>({
        procedure_id:proc.id,step_no:r.step_no,description:r.step_description,max_score:r.max_score,is_critical:r.critical
      })));
      if(stepError){setNotice(stepError.message);setBusy(false);return;}
    }
    setNotice(`Imported ${grouped.size} procedure(s).`); setUploadRows([]); setBusy(false); await loadAll();
  }

  async function submitAssessment() {
    if(!supabase||!profile||!activeProcedure||!selectedStudent||!selectedProgram)return;
    if(activeSteps.some(s=>scores[s.id||String(s.step_no)]===undefined)){setNotice('Score every assessment step before submitting.');return;}
    const criticalFailed=activeSteps.some(s=>s.is_critical && Number(scores[s.id||String(s.step_no)])===0);
    const pct=maxScore?totalScore/maxScore*100:0;
    const {data:assessment,error}=await supabase.from('assessments').insert({
      student_id:selectedStudent,program_id:selectedProgram,procedure_id:activeProcedure.id,examiner_id:profile.id,
      total_score:totalScore,max_score:maxScore,percentage:Number(pct.toFixed(2)),grade:gradeFor(pct),
      status:pct<60||criticalFailed?'Fail':'Pass',remarks:remarks.trim()||null
    }).select().single();
    if(error){setNotice(error.message);return;}
    const {error:detailError}=await supabase.from('assessment_scores').insert(activeSteps.map(s=>({
      assessment_id:assessment.id,step_id:s.id,score:Number(scores[s.id||String(s.step_no)])
    })));
    if(detailError){setNotice(`Assessment saved, but step details failed: ${detailError.message}`);return;}
    setNotice(`Assessment submitted. ${pct.toFixed(1)}% · ${gradeFor(pct)}${criticalFailed?' · Critical step failure':''}`);
    setScores({});setRemarks('');await loadAll();
  }

  function downloadTemplate(){
    const sample=[{program_code:'RGN',procedure_code:'RGN-001',procedure_title:'Hand Hygiene',step_no:1,step_description:'Remove hand jewellery',max_score:4,critical:true,pass_mark:60},
      {program_code:'RGN',procedure_code:'RGN-001',procedure_title:'Hand Hygiene',step_no:2,step_description:'Wet hands with clean running water',max_score:4,critical:false,pass_mark:60}];
    const ws=XLSX.utils.json_to_sheet(sample);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Procedure Manual');XLSX.writeFile(wb,'CliniSkills_Procedure_Import_Template.xlsx');
  }
  function exportRows(rows:Assessment[],format:'csv'|'xlsx'){
    const data=rows.map(a=>({student_name:a.student?.full_name||'',student_number:a.student?.student_number||'',program:a.program?.code||'',procedure:a.procedure?.title||'',score:a.total_score,max_score:a.max_score,percentage:a.percentage,grade:a.grade,status:a.status,examiner:a.examiner?.full_name||'',date:new Date(a.created_at).toLocaleString(),remarks:a.remarks||''}));
    const ws=XLSX.utils.json_to_sheet(data);
    if(format==='csv'){const csv=XLSX.utils.sheet_to_csv(ws);saveBlob(csv,'text/csv','cliniskills_results.csv');}
    else {const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Results');XLSX.writeFile(wb,'cliniskills_results.xlsx');}
  }
  function exportPdf(a:Assessment){
    const doc=new jsPDF();
    doc.setFontSize(18);doc.text('CliniSkills Assessment Report',14,18);
    doc.setFontSize(10);
    const lines=[`Student: ${a.student?.full_name||'N/A'} (${a.student?.student_number||'N/A'})`,`Programme: ${a.program?.code||'N/A'}`,`Procedure: ${a.procedure?.title||'N/A'} (${a.procedure?.code||''})`,`Examiner: ${a.examiner?.full_name||'N/A'}`,`Date: ${new Date(a.created_at).toLocaleString()}`,`Score: ${a.total_score}/${a.max_score} (${Number(a.percentage).toFixed(1)}%)`,`Grade: ${a.grade} | Status: ${a.status}`,`Remarks: ${a.remarks||'None'}`];
    lines.forEach((line,i)=>doc.text(line,14,30+i*7));
    autoTable(doc,{startY:96,head:[['Assessment detail','Score']],body:[['Total score',`${a.total_score}/${a.max_score}`],['Percentage',`${a.percentage}%`],['Grade',a.grade],['Result',a.status]]});
    doc.save(`CliniSkills_${a.id.slice(0,8)}.pdf`);
  }
  function saveBlob(content:string,type:string,name:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
  const myAssessments=useMemo(()=>profile?.role==='admin'?assessments:assessments.filter(a=>a.examiner_id===profile?.id),[assessments,profile]);
  const nav:[Tab,string,any][]=[['overview','Overview',Activity],['programs','Programs',BookOpen],['manuals','Procedure manuals',FileSpreadsheet],['students','Students',Users],['assessment','New assessment',ClipboardCheck],['results','Results',ShieldCheck]];

  if(!configured)return <main className="setup"><section className="setup-card"><div className="brand-mark"><Activity/></div><h1>CliniSkills</h1><p>Clinical and practical nursing assessment platform</p><h2>Connect your Supabase project</h2><ol><li>Create a Supabase project.</li><li>Run <b>supabase/schema.sql</b> in the Supabase SQL Editor.</li><li>Copy <b>.env.example</b> to <b>.env</b> and add your project URL and publishable/anon key.</li><li>Run <code>npm install</code>, then <code>npm run dev</code>.</li></ol><p className="muted">Never place your Supabase service-role key in frontend code.</p></section></main>;
  if(!sessionUser||!profile)return <main className="login-wrap"><form className="login-card" onSubmit={signIn}><div className="brand-mark"><Activity/></div><h1>CliniSkills</h1><p>Sign in to your assessment workspace</p><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} /></label><button className="primary full" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>{notice&&<div className="notice">{notice}</div>}</form></main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Activity/></div><div><b>CliniSkills</b><small>Clinical assessment</small></div></div>
      <div className="user-mini"><div className="avatar">{profile.full_name?.slice(0,1)||'U'}</div><div><b>{profile.full_name}</b><small>{profile.role==='admin'?'Administrator':'Examiner'}</small></div></div>
      <nav>{nav.map(([key,label,Icon])=><button key={key} className={tab===key?'nav-item active':'nav-item'} onClick={()=>setTab(key)}><Icon size={18}/>{label}</button>)}</nav>
      <button className="nav-item signout" onClick={signOut}><LogOut size={18}/>Sign out</button>
    </aside>
    <main className="main-area"><header className="topbar"><div><span className="eyebrow">NURSING EDUCATION</span><h2>{nav.find(x=>x[0]===tab)?.[1]}</h2></div><span className="role-pill">{profile.role}</span></header>
      {notice&&<div className="notice global-notice"><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}
      {tab==='overview'&&<><div className="welcome"><div><span className="eyebrow light">ASSESSMENT WORKSPACE</span><h1>Welcome back, {profile.full_name.split(' ')[0]}</h1><p>Manage practical assessments and monitor student performance.</p></div><ClipboardCheck size={64}/></div><div className="stats"><Stat title="Active programmes" value={programs.filter(p=>p.is_active).length}/><Stat title="Students" value={students.length}/><Stat title="Procedures" value={procedures.length}/><Stat title="Assessments" value={myAssessments.length}/></div><Panel title="Recent assessments"><ResultsTable rows={myAssessments.slice(0,6)} onPdf={exportPdf}/></Panel></>}
      {tab==='programs'&&<><Panel title="Add a programme"><form className="inline-form" onSubmit={addProgram}><input placeholder="Programme code e.g. RGN" required value={newProgram.code} onChange={e=>setNewProgram({...newProgram,code:e.target.value})}/><input placeholder="Programme name" required value={newProgram.name} onChange={e=>setNewProgram({...newProgram,name:e.target.value})}/><button className="primary"><Plus size={16}/>Add programme</button></form></Panel><Panel title="Programme list"><div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Status</th><th></th></tr></thead><tbody>{programs.map(p=><tr key={p.id}><td><b>{p.code}</b></td><td>{p.name}</td><td><span className={p.is_active?'status good':'status'}>{p.is_active?'Active':'Archived'}</span></td><td><button className="small-btn" onClick={()=>toggleProgram(p)}>{p.is_active?'Archive':'Activate'}</button></td></tr>)}</tbody></table></div></Panel></>}
      {tab==='manuals'&&<><Panel title="Import procedure manual"><p className="muted">Upload a CSV or Excel file. Each row represents one procedure step. Existing procedure codes for the same programme are updated.</p><div className="toolbar"><button className="secondary" onClick={downloadTemplate}><Download size={16}/>Download Excel template</button><label className="upload-btn">Choose CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" onChange={e=>e.target.files?.[0]&&parseManual(e.target.files[0])}/></label></div>{uploadErrors.length>0&&<div className="error-box"><b>Validation issues</b>{uploadErrors.map((x,i)=><div key={i}>• {x}</div>)}</div>}{uploadRows.length>0&&<><p className="muted">{uploadRows.length} row(s) ready for preview.</p><div className="table-wrap"><table><thead><tr><th>Programme</th><th>Procedure</th><th>Step</th><th>Description</th><th>Max score</th><th>Critical</th></tr></thead><tbody>{uploadRows.slice(0,100).map((r,i)=><tr key={i}><td>{r.program_code}</td><td>{r.procedure_code} · {r.procedure_title}</td><td>{r.step_no}</td><td>{r.step_description}</td><td>{r.max_score}</td><td>{r.critical?'Yes':'No'}</td></tr>)}</tbody></table></div><button className="primary mt" disabled={busy||uploadErrors.length>0} onClick={saveManual}>{busy?'Importing…':'Validate and save manual'}</button></>}</Panel><Panel title="Imported procedures"><div className="table-wrap"><table><thead><tr><th>Programme</th><th>Code</th><th>Procedure</th><th>Steps</th><th>Pass mark</th></tr></thead><tbody>{procedures.map(p=><tr key={p.id}><td>{programs.find(x=>x.id===p.program_id)?.code}</td><td>{p.code}</td><td>{p.title}</td><td>{p.steps?.length||0}</td><td>{p.pass_mark}%</td></tr>)}</tbody></table></div></Panel></>}
      {tab==='students'&&<><Panel title="Register student"><form className="form-grid" onSubmit={addStudent}><label>Student number<input required value={newStudent.student_number} onChange={e=>setNewStudent({...newStudent,student_number:e.target.value})}/></label><label>Full name<input required value={newStudent.full_name} onChange={e=>setNewStudent({...newStudent,full_name:e.target.value})}/></label><label>Programme<select required value={newStudent.program_id} onChange={e=>setNewStudent({...newStudent,program_id:e.target.value})}><option value="">Select programme</option>{programs.filter(p=>p.is_active).map(p=><option value={p.id} key={p.id}>{p.code} · {p.name}</option>)}</select></label><label>Cohort<input value={newStudent.cohort} onChange={e=>setNewStudent({...newStudent,cohort:e.target.value})} placeholder="e.g. 2025/2026"/></label><label>Level<input value={newStudent.level} onChange={e=>setNewStudent({...newStudent,level:e.target.value})} placeholder="e.g. Level 200"/></label><button className="primary">Save student</button></form></Panel><Panel title="Student records"><div className="table-wrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Programme</th><th>Cohort</th><th>Level</th></tr></thead><tbody>{students.map(s=><tr key={s.id}><td>{s.student_number}</td><td>{s.full_name}</td><td>{programs.find(p=>p.id===s.program_id)?.code}</td><td>{s.cohort||'—'}</td><td>{s.level||'—'}</td></tr>)}</tbody></table></div></Panel></>}
      {tab==='assessment'&&<Panel title="Practical procedure assessment"><div className="form-grid three"><label>Programme<select value={selectedProgram} onChange={e=>{setSelectedProgram(e.target.value);setSelectedProcedure('');}}><option value="">Select programme</option>{programs.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.code}</option>)}</select></label><label>Student<select value={selectedStudent} onChange={e=>setSelectedStudent(e.target.value)}><option value="">Select student</option>{students.filter(s=>!selectedProgram||s.program_id===selectedProgram).map(s=><option key={s.id} value={s.id}>{s.student_number} · {s.full_name}</option>)}</select></label><label>Procedure<select value={selectedProcedure} onChange={e=>{setSelectedProcedure(e.target.value);setScores({});}}><option value="">Select procedure</option>{procedures.filter(p=>p.program_id===selectedProgram).map(p=><option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></label></div>
        {activeProcedure&&<><div className="assessment-heading"><div><h3>{activeProcedure.title}</h3><p>{activeProcedure.code} · Pass mark {activeProcedure.pass_mark}%</p></div><div className="score-chip">{totalScore}/{maxScore}<small>{percentage.toFixed(1)}%</small></div></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Assessment step</th><th>Max</th><th>Critical</th><th>Score</th></tr></thead><tbody>{activeSteps.map(s=><tr key={s.id||s.step_no}><td>{s.step_no}</td><td>{s.description}</td><td>{s.max_score}</td><td>{s.is_critical?<span className="status danger">Mandatory</span>:'—'}</td><td><select className="score-select" value={scores[s.id||String(s.step_no)]??''} onChange={e=>setScores({...scores,[s.id||String(s.step_no)]:Number(e.target.value)})}><option value="">Score</option>{Array.from({length:Math.floor(s.max_score)+1},(_,i)=><option key={i} value={i}>{i}</option>)}</select></td></tr>)}</tbody></table></div><label className="remarks">Examiner remarks<textarea rows={3} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Enter observations or feedback…"/></label><div className="assessment-footer"><div><b>{percentage.toFixed(1)}%</b><span className={`grade ${gradeFor(percentage)==='Fail'?'bad':'good'}`}>{gradeFor(percentage)}</span></div><button className="primary" onClick={submitAssessment}>Submit assessment</button></div></>}</Panel>}
      {tab==='results'&&<Panel title="Assessment results"><div className="toolbar"><span className="muted">{myAssessments.length} assessment record(s)</span><div><button className="secondary" onClick={()=>exportRows(myAssessments,'xlsx')}><Download size={15}/>Excel</button> <button className="secondary" onClick={()=>exportRows(myAssessments,'csv')}>CSV</button></div></div><ResultsTable rows={myAssessments} onPdf={exportPdf}/></Panel>}
    </main>
  </div>;
}
function Stat({title,value}:{title:string;value:number}){return <div className="stat-card"><span>{title}</span><b>{value}</b></div>}
function Panel({title,children}:{title:string;children:any}){return <section className="panel"><div className="panel-title"><h3>{title}</h3></div>{children}</section>}
function ResultsTable({rows,onPdf}:{rows:Assessment[];onPdf:(a:Assessment)=>void}){return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Programme</th><th>Procedure</th><th>Score</th><th>Grade</th><th>Examiner</th><th>Date</th><th>Report</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td><b>{a.student?.full_name||'—'}</b><small className="cell-sub">{a.student?.student_number}</small></td><td>{a.program?.code||'—'}</td><td>{a.procedure?.title||'—'}</td><td>{Number(a.percentage).toFixed(1)}%</td><td><span className={`status ${a.grade==='Fail'?'danger':'good'}`}>{a.grade}</span></td><td>{a.examiner?.full_name||'—'}</td><td>{new Date(a.created_at).toLocaleDateString()}</td><td><button className="small-btn" onClick={()=>onPdf(a)}>PDF</button></td></tr>)}</tbody></table>{!rows.length&&<p className="empty">No assessment records yet.</p>}</div>}
