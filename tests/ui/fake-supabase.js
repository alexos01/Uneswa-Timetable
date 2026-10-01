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
    grant_staff_role(args, ctx){
      const u = ctx.users.find(x=>x.email===args.p_email);
      if(!u) return { data:null, error:{ message:`No account uses ${args.p_email}. Ask them to create one under Staff sign in first.` } };
      const row = { user_id:u.id, role:args.p_role, campus_id: args.p_role==='super_admin' ? null : args.p_campus, email:args.p_email, display_name:args.p_name };
      ctx.tables.staff = ctx.tables.staff.filter(x=>x.user_id!==u.id); ctx.tables.staff.push(row);
      return { data:row, error:null };
    },
  };
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
    then(res, rej){ return Promise.resolve().then(()=>this.exec()).then(res, rej); }
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

  function setSession(user){
    session = user ? { access_token:'fake', user:{ id:user.id, email:user.email } } : null;
    authListeners.forEach(cb=>setTimeout(()=>cb(session?'SIGNED_IN':'SIGNED_OUT', session),0));
  }
  if(seed.signedInAs){ const u = users.find(x=>x.email===seed.signedInAs); if(u) session = { access_token:'fake', user:{ id:u.id, email:u.email } }; }

  const client = {
    from: t=>new Query(t),
    rpc: async (name, args)=>{
      window.__FAKE_LOG__.push({ rpc:name, args });
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
