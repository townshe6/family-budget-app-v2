import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { addDays, endOfMonth, format, isWithinInterval, parseISO, startOfMonth, subDays } from 'date-fns';
import { ArrowLeft, ArrowRight, LogOut, Plus, Settings, Trash2, WalletCards, X } from 'lucide-react';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function getBudgetPeriod(date, cadence) {
  if (cadence === 'monthly') return { start: startOfMonth(date), end: endOfMonth(date) };
  const day = date.getDay();
  const daysSinceFriday = (day + 2) % 7;
  const start = subDays(date, daysSinceFriday);
  return { start, end: addDays(start, 6) };
}

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [household, setHousehold] = useState(null);
  const [buckets, setBuckets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadAll();
  }, [session]);

  async function loadAll() {
    setLoading(true); setError('');
    const { data: p, error: pe } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (pe) { setError(pe.message); setLoading(false); return; }
    setProfile(p);
    const [{ data: h }, { data: b }, { data: t }] = await Promise.all([
      supabase.from('households').select('*').eq('id', p.household_id).single(),
      supabase.from('budget_buckets').select('*').eq('household_id', p.household_id).eq('is_active', true).order('sort_order'),
      supabase.from('transactions').select('*, profiles(display_name)').eq('household_id', p.household_id).order('spent_on', { ascending: false }).order('created_at', { ascending: false })
    ]);
    setHousehold(h); setBuckets(b || []); setTransactions(t || []); setLoading(false);
  }

  if (loading) return <div className="center"><div className="spinner" />Loading budget…</div>;
  if (!supabase) return <SetupRequired />;
  if (!session) return <Auth />;
  if (error) return <div className="center error">{error}<button onClick={loadAll}>Try again</button></div>;
  if (!profile) return <div className="center">Account setup is incomplete.</div>;

  const monthStart = startOfMonth(viewDate), monthEnd = endOfMonth(viewDate);
  const monthTransactions = transactions.filter(t => isWithinInterval(parseISO(t.spent_on), { start: monthStart, end: monthEnd }));
  const currentWeekly = buckets.find(b => b.is_primary);
  const currentPeriod = currentWeekly ? getBudgetPeriod(new Date(), 'weekly') : null;
  const isOwner = profile.role === 'owner';

  return <div className="app-shell">
    <header>
      <div><span className="eyebrow">{household?.name || 'Family budget'}</span><h1>Budget overview</h1></div>
      <button className="icon-button" onClick={() => supabase.auth.signOut()} aria-label="Sign out"><LogOut size={20}/></button>
    </header>

    {currentWeekly && <section className="hero-card">
      <div className="hero-top"><div><span className="label">Current weekly budget</span><strong>{format(currentPeriod.start, 'MMM d')}–{format(currentPeriod.end, 'MMM d')}</strong></div><WalletCards size={28}/></div>
      <BudgetMeter bucket={currentWeekly} transactions={transactions} date={new Date()} />
      <button className="primary" onClick={() => setModal({ type: 'transaction', bucket: currentWeekly })}><Plus size={18}/> Add spending</button>
    </section>}

    <div className="month-nav">
      <button className="icon-button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1))}><ArrowLeft size={19}/></button>
      <div><span className="label">Viewing</span><h2>{format(viewDate, 'MMMM yyyy')}</h2></div>
      <button className="icon-button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1))}><ArrowRight size={19}/></button>
    </div>

    <section className="summary-grid">
      <div className="stat"><span>Spent this month</span><strong>{money.format(monthTransactions.reduce((s,t)=>s+Number(t.amount),0))}</strong></div>
      <div className="stat"><span>Transactions</span><strong>{monthTransactions.length}</strong></div>
    </section>

    <section className="section-heading"><div><span className="eyebrow">Budget buckets</span><h2>Current balances</h2></div>{isOwner && <button className="secondary" onClick={() => setModal({ type: 'bucket' })}><Settings size={17}/> Manage</button>}</section>
    <div className="bucket-list">
      {buckets.map(bucket => <button className="bucket-card" key={bucket.id} onClick={() => setModal({type:'details', bucket})}>
        <div className="bucket-title"><div><h3>{bucket.name}</h3><span>{bucket.cadence === 'weekly' ? 'Weekly' : 'Monthly'} · {format(getBudgetPeriod(viewDate,bucket.cadence).start,'MMM d')}–{format(getBudgetPeriod(viewDate,bucket.cadence).end,'MMM d')}</span></div><Plus size={18}/></div>
        <BudgetMeter bucket={bucket} transactions={transactions} date={viewDate} compact />
      </button>)}
    </div>

    <section className="section-heading"><div><span className="eyebrow">Activity</span><h2>{format(viewDate, 'MMMM')} spending</h2></div></section>
    <div className="activity-list">
      {monthTransactions.length === 0 ? <div className="empty">No spending entered for this month.</div> : monthTransactions.map(t => <div className="activity" key={t.id}>
        <div><strong>{t.description || buckets.find(b=>b.id===t.bucket_id)?.name || 'Spending'}</strong><span>{format(parseISO(t.spent_on),'EEE, MMM d')} · {t.profiles?.display_name || 'Household'}</span></div><strong>{money.format(Number(t.amount))}</strong>
      </div>)}
    </div>

    {modal && <Modal onClose={()=>setModal(null)}>
      {modal.type === 'transaction' && <TransactionForm bucket={modal.bucket} profile={profile} household={household} onDone={()=>{setModal(null);loadAll();}}/>}
      {modal.type === 'details' && <BucketDetails bucket={modal.bucket} transactions={transactions} viewDate={viewDate} profile={profile} household={household} isOwner={isOwner} onDone={()=>{setModal(null);loadAll();}} onAdd={()=>setModal({type:'transaction',bucket:modal.bucket})}/>} 
      {modal.type === 'bucket' && <BucketManager buckets={buckets} profile={profile} household={household} onDone={()=>{setModal(null);loadAll();}}/>}
    </Modal>}
  </div>;
}

function BudgetMeter({ bucket, transactions, date, compact=false }) {
  const period = getBudgetPeriod(date, bucket.cadence);
  const spent = transactions.filter(t => t.bucket_id===bucket.id && isWithinInterval(parseISO(t.spent_on), period)).reduce((s,t)=>s+Number(t.amount),0);
  const remaining = Number(bucket.amount)-spent;
  const pct = Math.min(100, Math.max(0, spent/Number(bucket.amount)*100 || 0));
  return <div className={compact?'meter compact':'meter'}>
    <div className="meter-values"><div><span>Remaining</span><strong className={remaining<0?'negative':''}>{money.format(remaining)}</strong></div><div><span>Spent</span><strong>{money.format(spent)} / {money.format(Number(bucket.amount))}</strong></div></div>
    <div className="track"><div style={{width:`${pct}%`}} className={remaining<0?'fill over':'fill'} /></div>
  </div>
}

function Auth() {
  const [mode,setMode]=useState('login'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [householdName,setHouseholdName]=useState(''); const [invite,setInvite]=useState(''); const [message,setMessage]=useState('');
  async function submit(e){e.preventDefault();setMessage('');
    if(mode==='login'){const {error}=await supabase.auth.signInWithPassword({email,password}); if(error)setMessage(error.message);return;}
    const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:name,household_name:householdName,invite_code:invite.trim().toUpperCase()}}});
    setMessage(error?error.message:(data.session?'Account created.':'Check your email to confirm your account.'));
  }
  return <div className="auth-page"><div className="auth-card"><span className="eyebrow">Shared family finances</span><h1>{mode==='login'?'Sign in':'Create account'}</h1><p>Both spouses use their own login and see the same household budget.</p>
    <form onSubmit={submit}>{mode==='signup'&&<><label>Your name<input value={name} onChange={e=>setName(e.target.value)} required/></label><label>Household name <small>Only needed for the first account</small><input value={householdName} onChange={e=>setHouseholdName(e.target.value)} placeholder="Townshend Family"/></label><label>Invite code <small>Use this instead when joining</small><input value={invite} onChange={e=>setInvite(e.target.value)} placeholder="ABC123"/></label></>}
    <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" minLength="8" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="primary">{mode==='login'?'Sign in':'Create account'}</button></form>
    {message&&<div className="notice">{message}</div>}<button className="text-button" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Create a household or join one':'Already have an account? Sign in'}</button></div></div>
}

function TransactionForm({bucket,profile,household,onDone}){const [amount,setAmount]=useState('');const [description,setDescription]=useState('');const [date,setDate]=useState(format(new Date(),'yyyy-MM-dd'));const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 async function save(e){e.preventDefault();setSaving(true);const {error}=await supabase.from('transactions').insert({household_id:household.id,bucket_id:bucket.id,user_id:profile.id,amount:Number(amount),description,spent_on:date});setSaving(false);if(error)setError(error.message);else onDone();}
 return <><h2>Add spending</h2><p className="modal-subtitle">{bucket.name}</p><form onSubmit={save}><label>Amount<input autoFocus type="number" step="0.01" min="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><label>Description<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Groceries, clothing, school…"/></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>{error&&<div className="notice error">{error}</div>}<button className="primary" disabled={saving}>{saving?'Saving…':'Save spending'}</button></form></>}

function BucketDetails({bucket,transactions,viewDate,profile,household,isOwner,onDone,onAdd}){const period=getBudgetPeriod(viewDate,bucket.cadence);const items=transactions.filter(t=>t.bucket_id===bucket.id&&isWithinInterval(parseISO(t.spent_on),period));async function remove(id){if(!confirm('Delete this spending entry?'))return;await supabase.from('transactions').delete().eq('id',id);onDone();}
 return <><h2>{bucket.name}</h2><p className="modal-subtitle">{format(period.start,'MMM d')}–{format(period.end,'MMM d, yyyy')}</p><BudgetMeter bucket={bucket} transactions={transactions} date={viewDate}/><button className="primary" onClick={onAdd}><Plus size={18}/>Add spending</button><div className="detail-list">{items.map(t=><div className="activity" key={t.id}><div><strong>{t.description||'Spending'}</strong><span>{format(parseISO(t.spent_on),'MMM d')}</span></div><div className="row"><strong>{money.format(Number(t.amount))}</strong>{(isOwner||t.user_id===profile.id)&&<button className="icon-button danger" onClick={()=>remove(t.id)}><Trash2 size={17}/></button>}</div></div>)}</div></>}

function BucketManager({buckets,profile,household,onDone}){const [rows,setRows]=useState(buckets.map(b=>({...b,amount:String(b.amount)})));const [error,setError]=useState('');
 function add(){if(rows.length>=11)return;setRows([...rows,{id:null,name:'',amount:'',cadence:'monthly',is_primary:false,is_active:true,sort_order:rows.length}]);}
 async function save(){if(rows.filter(r=>!r.is_primary).length>10){setError('You can have up to 10 additional buckets.');return;} const payload=rows.map((r,i)=>({id:r.id||undefined,household_id:household.id,name:r.name,amount:Number(r.amount),cadence:r.cadence,is_primary:r.is_primary,is_active:r.is_active!==false,sort_order:i,created_by:profile.id}));const {error}=await supabase.from('budget_buckets').upsert(payload);if(error)setError(error.message);else onDone();}
 async function deactivate(row,i){if(row.is_primary){setError('The primary weekly budget cannot be removed.');return;} if(row.id) await supabase.from('budget_buckets').update({is_active:false}).eq('id',row.id);setRows(rows.filter((_,idx)=>idx!==i));}
 return <><h2>Manage budgets</h2><p className="modal-subtitle">Edit amounts or add up to 10 extra weekly or monthly buckets.</p><div className="manager-list">{rows.map((r,i)=><div className="manager-row" key={r.id||i}><input value={r.name} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,name:e.target.value}:x))} placeholder="Bucket name"/><div className="row"><input type="number" step="0.01" min="0" value={r.amount} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,amount:e.target.value}:x))}/><select value={r.cadence} disabled={r.is_primary} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,cadence:e.target.value}:x))}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select><button className="icon-button danger" onClick={()=>deactivate(r,i)}><Trash2 size={17}/></button></div></div>)}</div>{rows.length<11&&<button className="secondary full" onClick={add}><Plus size={17}/>Add bucket</button>}{error&&<div className="notice error">{error}</div>}<button className="primary" onClick={save}>Save budgets</button><div className="invite-box"><span>Spouse invite code</span><strong>{household.invite_code}</strong></div></>}

function Modal({children,onClose}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal"><button className="close" onClick={onClose}><X size={20}/></button>{children}</div></div>}
function SetupRequired(){return <div className="auth-page"><div className="auth-card"><h1>Connect the database</h1><p>This app is built, but it needs your Supabase project credentials before two phones can share data.</p><ol><li>Copy <code>.env.example</code> to <code>.env</code>.</li><li>Add your Supabase URL and publishable key.</li><li>Run the included <code>supabase-schema.sql</code> in Supabase SQL Editor.</li></ol></div></div>}

createRoot(document.getElementById('root')).render(<App/>);
