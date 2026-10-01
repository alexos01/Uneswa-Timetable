// Seed data for the fake backend. legacySeed() mirrors the live database before
// the multi-campus migration; campusSeed() mirrors it after.
const FAC_SCI = 'fac-sci', FAC_COM = 'fac-com';
const BSC_CS = 'prog-bsc-cs', BCOM = 'prog-bcom';

function session(id, code, day, start, end, venue, programme_id, extra={}){
  return { id, code, day, start_time:start, end_time:end, venue, programme_id, ...extra };
}

export function legacySeed(){
  return {
    tables: {
      faculties: [ { id:FAC_SCI, name:'Faculty of Science and Engineering' }, { id:FAC_COM, name:'Faculty of Commerce' } ],
      programmes: [ { id:BSC_CS, name:'B.Sc. Computer Science', faculty_id:FAC_SCI }, { id:BCOM, name:'Bachelor of Commerce', faculty_id:FAC_COM } ],
      modules: [
        session('m1','CSC111','Monday','08:00','08:50','SC.LEC.TH.I',BSC_CS),
        session('m2','CSC111','Wednesday','10:00','10:50','SC.LEC.TH.I',BSC_CS),
        session('m3','CSC211','Tuesday','09:00','09:50','G.005',BSC_CS),
        session('m4','MAT111','Thursday','15:00','15:50','MPH',BSC_CS),
        session('m5','ACF111','Monday','08:00','08:50','G.006',BCOM),
        session('m6','CSC111','Friday','11:00','11:50','G.010',BCOM),
      ],
      exams: [ { id:'e1', code:'CSC111', exam_date:'2026-12-05', start_time:'09:00', end_time:'12:00', venue:'MPH', programme_id:BSC_CS } ],
      settings: [ { id:1, semester:'Semester 1 2026/2027', semester_version:1, updated_at:'2026-09-17T07:43:19Z' } ],
      students: [],
    },
    users: [ { id:'u-admin', email:'admin@test.local', password:'secret' } ],
  };
}

export const ids = { FAC_SCI, FAC_COM, BSC_CS, BCOM };

function future(days){ const d = new Date(); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }

export function campusSeed(){
  const s = legacySeed();
  const t = s.tables;
  t.campuses = [ { id:'kwaluseni', name:'Kwaluseni', sort:1 }, { id:'luyengo', name:'Luyengo', sort:2 }, { id:'mbabane', name:'Mbabane', sort:3 } ];
  for(const k of ['faculties','programmes','modules','exams']) t[k].forEach(r=>{ r.campus_id = 'kwaluseni'; });
  t.modules.forEach(m=>{ m.id = 'k'+m.id.slice(1); });
  t.faculties.push({ id:'fac-agr', name:'Faculty of Agriculture', campus_id:'luyengo' });
  t.programmes.push({ id:'prog-agr', name:'B.Sc. Agriculture', faculty_id:'fac-agr', campus_id:'luyengo' });
  t.modules.push({ id:'l1', code:'AGR111', day:'Monday', start_time:'08:00', end_time:'08:50', venue:'LY.1', programme_id:'prog-agr', campus_id:'luyengo' });
  t.campus_settings = [
    { campus_id:'kwaluseni', semester:'Semester 1 2026/2027', semester_version:1, updated_at:'2026-09-17T07:43:19Z' },
    { campus_id:'luyengo', semester:'Semester 1 Luyengo', semester_version:1, updated_at:'2026-09-20T07:00:00Z' },
    { campus_id:'mbabane', semester:'Not set yet', semester_version:1, updated_at:'2026-09-20T07:00:00Z' },
  ];
  t.staff = [
    { user_id:'u-admin', role:'super_admin', campus_id:null, email:'admin@test.local', display_name:'Super Admin' },
    { user_id:'u-kadmin', role:'campus_admin', campus_id:'kwaluseni', email:'kadmin@test.local', display_name:'Kwaluseni Admin' },
    { user_id:'u-lect', role:'lecturer', campus_id:'kwaluseni', email:'lect@test.local', display_name:'Dr Lecturer' },
  ];
  t.lecturer_modules = [ { user_id:'u-lect', campus_id:'kwaluseni', code:'CSC111' } ];
  t.announcements = [
    { id:'a1', campus_id:'kwaluseni', title:'Welcome back', body:'Classes start Monday.', pinned:false, created_at:'2026-09-15T08:00:00Z' },
    { id:'a2', campus_id:null, title:'Exam timetable is out', body:'Check the exams card.', pinned:true, created_at:'2026-09-10T08:00:00Z' },
    { id:'a3', campus_id:'luyengo', title:'Luyengo only', body:'', pinned:false, created_at:'2026-09-16T08:00:00Z' },
    { id:'a4', campus_id:'kwaluseni', title:'Expired', body:'', pinned:false, created_at:'2026-09-01T08:00:00Z', expires_at:'2026-09-02T00:00:00Z' },
  ];
  t.class_notices = [
    { id:'n1', campus_id:'kwaluseni', code:'CSC111', kind:'test', notice_date:future(3), start_time:'10:00', end_time:'11:00', venue:'MPH', title:'Test 1', author_name:'Dr Lecturer' },
    { id:'n2', campus_id:'kwaluseni', code:'MAT111', kind:'cancelled', notice_date:future(2) },
  ];
  s.users.push({ id:'u-kadmin', email:'kadmin@test.local', password:'secret' }, { id:'u-lect', email:'lect@test.local', password:'secret' }, { id:'u-new', email:'new@test.local', password:'secret123' });
  return s;
}
