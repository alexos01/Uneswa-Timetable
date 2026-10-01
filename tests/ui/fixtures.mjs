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
