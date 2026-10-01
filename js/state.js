/* ---------------- app state ---------------- */
export const state = {
  faculties:[], programmes:[], modules:[], exams:[],
  meta:{semester:"Not set yet", updated_at:null, semester_version:1},
  isAdmin:false, adminSession:null,
  currentStudentId:null, currentStudent:null, resetNotice:false,
  pickFaculty:'', pickProgramme:'', pickYear:'', searchQuery:'', searchAllCourses:false,
  notif:{enabled:false, minutesBefore:15},
  tab:'student', adminTab:'faculties',
  aiImportFaculty:'', aiImportProgramme:'', aiImportKind:'modules', aiPages:[], aiPending:[], aiStatus:'', aiDebugRaw:[], aiPasteText:'',
  studentSearch:'', editingStudentId:null, students:[]
};

export function progName(id){ const p = state.programmes.find(x=>x.id===id); return p? p.name : 'Unassigned'; }
export function facName(id){ const f = state.faculties.find(x=>x.id===id); return f? f.name : 'No faculty'; }
export function programmesInFaculty(facId){ return state.programmes.filter(p=>p.faculty_id===facId); }
export function moduleYear(code){
  const m = (code||'').match(/[A-Z]{2,5}(\d)\d{2}/);
  return m ? Number(m[1]) : null;
}
export function yearLabel(y){
  if(y==null) return 'Other';
  const suffix = y===1?'st':y===2?'nd':y===3?'rd':'th';
  return `${y}${suffix} year`;
}
