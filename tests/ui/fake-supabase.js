/* In-memory stand-in for supabase-js used by the UI tests.
   The test runner serves this file in place of vendor/supabase.js, so the app runs
   its real code paths without touching the live project. Seed data comes from
   window.__FAKE_DB__ (set with page.addInitScript); a table missing from the seed
   behaves like a table that does not exist yet (PostgREST PGRST205), which lets the
   tests cover both the pre-migration and post-migration database. */
(function(){
  const seed = window.__FAKE_DB__ || {};
  const tables = seed.tables || {};
  const users = seed.users || [];            // [{id, email, password}]
  // RPCs implemented in the browser (seed data arrives as JSON, so it cannot carry functions).
  const rpcs = {
    app_schema_version(){
      return seed.schemaVersion ? { data: seed.schemaVersion, error:null } : { data:null, error:{ code:'PGRST202', message:'Could not find the function public.app_schema_version' } };
    },
    save_push_subscription(args, ctx){
      if(!ctx.tables.push_subscriptions) return { data:null, error:{ code:'PGRST202', message:'Could not find the function public.save_push_subscription' } };
      const codes = [...new Set(ctx.tables.modules.filter(m=>(args.p_module_ids||[]).includes(m.id)).map(m=>m.code))].sort();
      const row = { endpoint:args.p_endpoint, p256dh:args.p_p256dh, auth:args.p_auth, campus_id:args.p_campus, student_id:args.p_student,
        module_ids:args.p_module_ids, codes, minutes_before:args.p_minutes_before, reminders:args.p_reminders };
      ctx.tables.push_subscriptions = ctx.tables.push_subscriptions.filter(x=>x.endpoint!==row.endpoint).concat([row]);
      return { data:null, error:null };
    },
    delete_push_subscription(args, ctx){
      ctx.tables.push_subscriptions = (ctx.tables.push_subscriptions||[]).filter(x=>x.endpoint!==args.p_endpoint);
      return { data:null, error:null };
    },
    // Student passwords (migration 004), mirroring the SQL functions. Passwords are kept
    // as plain text here: this is test data in the browser, not a database.
    student_account_status(args, ctx){
      if(!v4()) return notFound('student_account_status');
      const id = String(args.p_id).trim();
      if(!ctx.tables.students.some(r=>r.id===id)) return { data:'new', error:null };
      return { data: creds().some(c=>c.student_id===id) ? 'password' : 'no_password', error:null };
    },
    student_sign_in(args, ctx){
      if(!v4()) return notFound('student_sign_in');
      const id = String(args.p_id||'').trim(), pw = args.p_password || '', name = (args.p_name||'').trim() || null;
      if(!/^[0-9A-Za-z]{4,20}$/.test(id)) return { data:{ error:'bad_id' }, error:null };
      if(pw.length < 6 || pw.length > 72) return { data:{ error:'short_password' }, error:null };
      const cred = creds().find(c=>c.student_id===id);
      if(cred){
        if(cred.locked_until && new Date(cred.locked_until) > new Date()) return { data:{ error:'locked', until:cred.locked_until }, error:null };
        if(cred.password !== pw){
          if(cred.failed_attempts + 1 >= 5){ cred.failed_attempts = 0; cred.locked_until = new Date(Date.now()+15*60000).toISOString(); return { data:{ error:'locked', until:cred.locked_until }, error:null }; }
          cred.failed_attempts++;
          return { data:{ error:'wrong_password', attempts_left: 5 - cred.failed_attempts }, error:null };
        }
        cred.failed_attempts = 0; cred.locked_until = null;
      }else{
        if(!ctx.tables.students.some(r=>r.id===id)) ctx.tables.students.push({ id, name, campus_id: args.p_campus || 'kwaluseni', programme_id:null, module_ids:[], semester_version:1, updated_at:new Date().toISOString(), history:[] });
        creds().push({ student_id:id, password:pw, failed_attempts:0, locked_until:null });
      }
      const row = ctx.tables.students.find(r=>r.id===id);
      if(name) row.name = name;
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join('');
      sessions().push({ token, student_id:id });
      return { data:{ token, student: clone(row) }, error:null };
    },
    student_get(args, ctx){
      if(!v4()) return notFound('student_get');
      const sess = sessions().find(x=>x.token===args.p_token);
      return { data: sess ? { student: clone(ctx.tables.students.find(r=>r.id===sess.student_id)) } : { error:'signed_out' }, error:null };
    },
    student_save(args, ctx){
      if(!v4()) return notFound('student_save');
      const sess = sessions().find(x=>x.token===args.p_token);
      if(!sess || sess.student_id !== args.p_student.id) return { data:{ error:'signed_out' }, error:null };
      const row = ctx.tables.students.find(r=>r.id===sess.student_id);
      for(const k of ['name','campus_id','module_ids','semester_version','history','updated_at']) if(k in args.p_student) row[k] = clone(args.p_student[k]);
      emit('students', 'UPDATE', row);
      return { data:{ student: clone(row) }, error:null };
    },
    student_sign_out(args){
      if(!v4()) return notFound('student_sign_out');
      tables.student_sessions = sessions().filter(x=>x.token!==args.p_token);
      return { data:null, error:null };
    },
    reset_student_password(args, ctx){
      if(!v4()) return notFound('reset_student_password');
      const row = ctx.tables.students.find(r=>r.id===args.p_id);
      const me = (ctx.tables.staff||[]).find(x=>x.user_id===ctx.uid);
      if(!row || !me || !(me.role==='super_admin' || (me.role==='campus_admin' && me.campus_id===row.campus_id)))
        return { data:null, error:{ code:'42501', message:"Only an admin of this student's campus can reset their password" } };
      tables.student_credentials = creds().filter(c=>c.student_id!==args.p_id);
      tables.student_sessions = sessions().filter(x=>x.student_id!==args.p_id);
      return { data:null, error:null };
    },
    grant_staff_role(args, ctx){
      const u = ctx.users.find(x=>x.email===args.p_email);
      if(!u) return { data:null, error:{ message:`No account uses ${args.p_email}. Ask them to create one under Staff sign in first.` } };
      const row = { user_id:u.id, role:args.p_role, campus_id: args.p_role==='super_admin' ? null : args.p_campus, email:args.p_email, display_name:args.p_name };
      ctx.tables.staff = ctx.tables.staff.filter(x=>x.user_id!==u.id); ctx.tables.staff.push(row);
      return { data:row, error:null };
    },
  };
  function v4(){ return (seed.schemaVersion||0) >= 4; }
  function notFound(name){ return { data:null, error:{ code:'PGRST202', message:`Could not find the function public.${name}` } }; }
  function creds(){ return tables.student_credentials = tables.student_credentials || []; }
  function sessions(){ return tables.student_sessions = tables.student_sessions || []; }
  const listeners = [];
  const authListeners = [];
  let session = null;
  window.__FAKE_LOG__ = [];

  function uuid(){ return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, ()=>(Math.random()*16|0).toString(16)); }
  function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function missing(t){ return { code:'PGRST205', message:`Could not find the table 'public.${t}' in the schema cache` }; }
  function emit(table, eventType, row){
    for(const l of listeners){
      if(l.table && l.table !== table) continue;
      if(l.event && l.event !== '*' && l.event !== eventType) continue;
      setTimeout(()=>l.cb({ table, eventType, new: row, old: row }), 0);
    }
  }

  class Query {
    constructor(table){ this.table=table; this.filters=[]; this.op='select'; this._order=[]; this._range=null; this._limit=null; this._single=null; this._returning=false; this._count=null; this._head=false; }
    select(cols, opts){ if(this.op==='select'){ this._count = opts && opts.count; this._head = !!(opts && opts.head); } else this._returning = true; return this; }
    insert(rows){ this.op='insert'; this.payload = Array.isArray(rows)? rows : [rows]; return this; }
    upsert(rows, opts){ this.op='upsert'; this.payload = Array.isArray(rows)? rows : [rows]; this.onConflict = (opts && opts.onConflict) || 'id'; return this; }
    update(obj){ this.op='update'; this.payload = obj; return this; }
    delete(){ this.op='delete'; return this; }
    eq(c,v){ this.filters.push(r=>String(r[c])===String(v)); return this; }
    neq(c,v){ this.filters.push(r=>String(r[c])!==String(v)); return this; }
    in(c,arr){ const s=new Set(arr.map(String)); this.filters.push(r=>s.has(String(r[c]))); return this; }
    is(c,v){ this.filters.push(r=>(r[c]??null)===v); return this; }
    or(expr){
      // supports "a.is.null,a.eq.x" style used by the app
      const parts = expr.split(',').map(p=>p.split('.'));
      this.filters.push(r=>parts.some(([c,op,...rest])=>{ const v=rest.join('.'); return op==='is' ? (r[c]??null)===null : String(r[c])===v; }));
      return this;
    }
    gte(c,v){ this.filters.push(r=>r[c]!=null && r[c]>=v); return this; }
    lte(c,v){ this.filters.push(r=>r[c]!=null && r[c]<=v); return this; }
    order(c,opts){ this._order.push([c, !(opts && opts.ascending===false)]); return this; }
    range(a,b){ this._range=[a,b]; return this; }
    limit(n){ this._limit=n; return this; }
    single(){ this._single='single'; return this; }
    maybeSingle(){ this._single='maybe'; return this; }
    then(res, rej){ return slow().then(()=>this.exec()).then(res, rej); }
    exec(){
      window.__FAKE_LOG__.push({ table:this.table, op:this.op, payload: clone(this.payload) });
      if(seed.failNetwork) return { data:null, error:{ message:'Failed to fetch' } };
      if(!(this.table in tables)) return { data:null, error: missing(this.table) };
      const rows = tables[this.table];
      const match = r=>this.filters.every(f=>f(r));
      let out;
      if(this.op==='select'){
        out = rows.filter(match);
        for(const [c,asc] of this._order.slice().reverse()) out.sort((a,b)=>{ const x=a[c]??'', y=b[c]??''; return (x<y?-1:x>y?1:0)*(asc?1:-1); });
        const count = out.length;
        if(this._range) out = out.slice(this._range[0], this._range[1]+1);
        if(this._limit!=null) out = out.slice(0, this._limit);
        if(this._head) return { data:null, count, error:null };
        return this.finish(clone(out), count);
      }
      if(this.op==='insert' || this.op==='upsert'){
        const written = [];
        for(const p of this.payload){
          const key = this.onConflict;
          const existing = this.op==='upsert' && p[key]!=null ? rows.find(r=>String(r[key])===String(p[key])) : null;
          if(existing){ Object.assign(existing, clone(p)); written.push(existing); emit(this.table,'UPDATE',existing); }
          else { const row = Object.assign({ id: uuid() }, (seed.defaults||{})[this.table]||{}, clone(p)); if(row.created_at===undefined) row.created_at = new Date().toISOString(); rows.push(row); written.push(row); emit(this.table,'INSERT',row); }
        }
        return this.finish(this._returning ? clone(written) : null);
      }
      if(this.op==='update'){
        const hit = rows.filter(match);
        hit.forEach(r=>{ Object.assign(r, clone(this.payload)); emit(this.table,'UPDATE',r); });
        return this.finish(this._returning ? clone(hit) : null);
      }
      if(this.op==='delete'){
        const keep = [], gone = [];
        rows.forEach(r=>(match(r)?gone:keep).push(r));
        tables[this.table] = keep;
        gone.forEach(r=>emit(this.table,'DELETE',r));
        return this.finish(this._returning ? clone(gone) : null);
      }
    }
    finish(data, count){
      if(this._single){
        const arr = Array.isArray(data) ? data : [];
        if(arr.length===0) return this._single==='maybe' ? { data:null, error:null } : { data:null, error:{ code:'PGRST116', message:'no rows' } };
        return { data: arr[0], error:null };
      }
      return { data, count, error:null };
    }
  }

  // seed.latencyMs: every request waits this long, like a slow phone connection.
  function slow(){ return seed.latencyMs ? new Promise(r=>setTimeout(r, seed.latencyMs)) : Promise.resolve(); }

  function setSession(user){
    session = user ? { access_token:'fake', user:{ id:user.id, email:user.email } } : null;
    authListeners.forEach(cb=>setTimeout(()=>cb(session?'SIGNED_IN':'SIGNED_OUT', session),0));
  }
  if(seed.signedInAs){ const u = users.find(x=>x.email===seed.signedInAs); if(u) session = { access_token:'fake', user:{ id:u.id, email:u.email } }; }

  // Storage: files kept in memory under "bucket/path"; seed.storage holds text files.
  // Public URLs point at /__storage__/ on the app's own origin and fetch() is answered here.
  const files = window.__FAKE_STORAGE__ = {};
  for(const [k, text] of Object.entries(seed.storage || {})) files[k] = new Blob([text], { type:'application/pdf' });
  const storageBase = `${location.origin}/__storage__/`;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init)=>{
    const url = typeof input === 'string' ? input : input.url;
    if(!url.startsWith(storageBase)) return realFetch(input, init);
    await slow();
    if(seed.failNetwork) throw new TypeError('Failed to fetch');
    const blob = files[decodeURIComponent(url.slice(storageBase.length))];
    return blob ? new Response(blob, { status:200, headers:{ 'Content-Type': blob.type } }) : new Response('Not found', { status:404 });
  };
  const storage = {
    from(bucket){
      return {
        async upload(path, file){
          await slow();
          if(seed.failNetwork) return { data:null, error:{ message:'Failed to fetch' } };
          if(files[`${bucket}/${path}`]) return { data:null, error:{ message:'The resource already exists' } };
          files[`${bucket}/${path}`] = file;
          return { data:{ path }, error:null };
        },
        async remove(paths){
          await slow();
          for(const p of paths) delete files[`${bucket}/${p}`];
          return { data:[], error:null };
        },
        getPublicUrl(path){ return { data:{ publicUrl: storageBase + encodeURIComponent(`${bucket}/${path}`) } }; },
      };
    },
  };

  const client = {
    storage,
    from: t=>new Query(t),
    rpc: async (name, args)=>{
      window.__FAKE_LOG__.push({ rpc:name, args });
      await slow();
      if(seed.failNetwork) return { data:null, error:{ message:'Failed to fetch' } };
      if(!rpcs[name]) return { data:null, error:{ code:'PGRST202', message:`Could not find the function public.${name}` } };
      return rpcs[name](args, { tables, users, uid: session && session.user.id });
    },
    channel(){
      const ch = {
        on(type, filter, cb){ listeners.push({ table: filter.table, event: filter.event, cb }); return ch; },
        subscribe(){ return ch; },
        unsubscribe(){},
      };
      return ch;
    },
    removeChannel(){},
    auth: {
      async getSession(){ return { data:{ session }, error:null }; },
      async getUser(){ return { data:{ user: session && session.user }, error:null }; },
      async signInWithPassword({ email, password }){
        const u = users.find(x=>x.email===email && x.password===password);
        if(!u) return { data:{}, error:{ message:'Invalid login credentials' } };
        setSession(u); return { data:{ session, user: session.user }, error:null };
      },
      async signUp({ email, password }){
        if(users.find(x=>x.email===email)) return { data:{}, error:{ message:'User already registered' } };
        const u = { id: uuid(), email, password }; users.push(u); setSession(u);
        return { data:{ user:{ id:u.id, email }, session }, error:null };
      },
      async signOut(){ setSession(null); return { error:null }; },
      onAuthStateChange(cb){ authListeners.push(cb); return { data:{ subscription:{ unsubscribe(){} } } }; },
    },
  };
  window.__FAKE_TABLES__ = tables;
  window.supabase = { createClient: ()=>client };
})();
