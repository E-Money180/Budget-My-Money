/* Budget My Money - Supabase-backed PWA.
   Uses the existing Supabase schema and preserves existing records. */
const SUPABASE_URL = "https://bdrjwmkegxcyicgujesb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_txlklLg5PURA10L37XzMKA_RythylvJ";
const $ = (id) => document.getElementById(id);
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.includes("YOUR_");
let db = null, user = null, authMode = "login", currentType = null, editingRecord = null;
let cache = { bills: [], income: [], transactions: [], goals: [], bank_accounts: [] };

const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n)||0);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const monthStart = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; };
const monthEnd = () => { const d=new Date(); return new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10); };
const frequencyMonthly = (amount, f) => ({
  weekly:amount*52/12, biweekly:amount*26/12, twice_monthly:amount*2,
  monthly:amount, monthly_nth_weekday:amount, quarterly:amount/3,
  yearly:amount/12, once:0
}[f] ?? amount);

function toast(msg){
  const el=$("toast");
  if(!el)return;
  el.textContent=msg;el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),3000);
}
function safeText(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function showAuth(){ $("auth").classList.remove("hidden");$("app").classList.add("hidden"); }
function showApp(){
  $("auth").classList.add("hidden");$("app").classList.remove("hidden");
  $("user-email").textContent=user.email;loadAll();
}
async function init(){
  $("today-label").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}).toUpperCase();
  if(!configured){$("auth-message").textContent="Setup required: check the Supabase URL and publishable key in app.js.";return;}
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:{session}}=await db.auth.getSession();
  if(session){user=session.user;showApp();}else showAuth();
  db.auth.onAuthStateChange((_event,session)=>{
    if(session){user=session.user;showApp();}else{user=null;showAuth();}
  });
}

document.querySelectorAll("[data-auth]").forEach(b=>b.addEventListener("click",()=>{
  authMode=b.dataset.auth;
  document.querySelectorAll("[data-auth]").forEach(x=>x.classList.toggle("active",x===b));
  $("auth-submit").textContent=authMode==="login"?"Sign in":"Create account";
  $("password").autocomplete=authMode==="login"?"current-password":"new-password";
}));
$("auth-form").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!db){$("auth-message").textContent="Configure Supabase first.";return;}
  const email=$("email").value,password=$("password").value;
  $("auth-submit").disabled=true;
  const result=authMode==="login"
    ? await db.auth.signInWithPassword({email,password})
    : await db.auth.signUp({email,password});
  $("auth-submit").disabled=false;
  if(result.error)$("auth-message").textContent=result.error.message;
  else if(authMode==="signup"&&!result.data.session)$("auth-message").textContent="Check your email to confirm your account, then sign in.";
  else toast("Welcome to Budget My Money");
});
$("signout").onclick=async()=>{await db.auth.signOut();};

async function loadAll(){
  if(!db||!user)return;
  const tables=["bills","income","transactions","goals","bank_accounts"];
  const results=await Promise.all(tables.map(t=>db.from(t).select("*").order("created_at",{ascending:false})));
  for(let i=0;i<tables.length;i++){
    if(results[i].error){console.error(results[i].error);toast("Could not load "+tables[i]);continue;}
    cache[tables[i]]=results[i].data||[];
  }
  renderAll();
  checkRenewalReminders();
}
async function insert(table,row){
  const {error}=await db.from(table).insert({...row,user_id:user.id});
  if(error)throw error;
  await loadAll();toast("Saved securely");
}
async function update(table,id,changes){
  const {error}=await db.from(table).update(changes).eq("id",id);
  if(error)throw error;
  await loadAll();toast("Changes saved");
}
async function remove(table,id){
  const {error}=await db.from(table).delete().eq("id",id);
  if(error)throw error;
  await loadAll();toast("Deleted");
}

function monthlyIncome(){return cache.income.reduce((s,x)=>s+frequencyMonthly(Number(x.amount),x.frequency),0);}
function monthlyBills(){return cache.bills.reduce((s,x)=>s+frequencyMonthly(Number(x.amount),x.frequency),0);}
function monthlyEveryday(){return cache.goals.filter(g=>g.goal_type==="spending").reduce((s,g)=>s+Number(g.monthly_budget||g.monthly_contribution||0),0);}
function monthlySavings(){return cache.goals.filter(g=>g.goal_type!=="spending").reduce((s,g)=>s+Number(g.monthly_contribution||0),0);}
function loggedExpenses(){
  return cache.transactions.filter(t=>t.kind==="expense"&&t.date>=monthStart()&&t.date<=monthEnd())
    .reduce((s,t)=>s+Number(t.amount),0);
}
function nextPayday(){
  const dates=cache.income.map(i=>i.next_payday).filter(d=>d&&d>=today()).sort();
  return dates[0]||null;
}
function nthWeekdayOfMonth(year,month,week,weekday){
  const first=new Date(year,month,1);
  const offset=(weekday-first.getDay()+7)%7;
  const day=1+offset+(Math.max(1,Number(week)||1)-1)*7;
  const result=new Date(year,month,day);
  if(result.getMonth()!==month)return null;
  return result;
}
function nextNthWeekdayDate(startDate,week,weekday){
  const start=new Date((startDate||today())+"T12:00:00");
  for(let offset=0;offset<24;offset++){
    const month=new Date(start.getFullYear(),start.getMonth()+offset,1);
    const candidate=nthWeekdayOfMonth(month.getFullYear(),month.getMonth(),week,weekday);
    if(candidate&&candidate>=start){
      return `${candidate.getFullYear()}-${String(candidate.getMonth()+1).padStart(2,"0")}-${String(candidate.getDate()).padStart(2,"0")}`;
    }
  }
  return startDate||today();
}
function billOccurrenceDates(bill,until){
  const dates=[];
  if(!bill.due_date)return dates;
  const start=today(),end=new Date(until+"T23:59:59");
  if(bill.frequency==="monthly_nth_weekday"){
    let cursor=bill.due_date;
    for(let i=0;i<24;i++){
      const occurrence=nextNthWeekdayDate(cursor,bill.recurrence_week||3,bill.recurrence_weekday??3);
      const d=new Date(occurrence+"T12:00:00");
      if(occurrence>=start&&d<=end)dates.push(occurrence);
      if(d>end)break;
      const nextMonth=new Date(d.getFullYear(),d.getMonth()+1,1);
      cursor=`${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,"0")}-01`;
    }
  }else if(bill.frequency==="monthly"){
    let d=new Date(bill.due_date+"T12:00:00");
    while(d<new Date(start+"T00:00:00"))d.setMonth(d.getMonth()+1);
    while(d<=end){
      dates.push(d.toISOString().slice(0,10));
      d.setMonth(d.getMonth()+1);
    }
  }else{
    const d=new Date(bill.due_date+"T12:00:00");
    if(bill.due_date>=start&&d<=end)dates.push(bill.due_date);
  }
  return dates;
}
function reservedBills(until){
  return cache.bills.reduce((sum,b)=>{
    if(b.paid)return sum;
    return sum+billOccurrenceDates(b,until).reduce(s=>s+(Number(b.amount)||0),0);
  },0);
}
function daysBetween(a,b){
  return Math.max(1,Math.ceil((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/86400000));
}
function paycheckSafe(){
  const payday=nextPayday();
  if(!payday)return {amount:0,payday:null,days:0};
  const days=daysBetween(today(),payday);
  const base=cache.income.filter(i=>i.next_payday===payday).reduce((s,i)=>s+Number(i.amount),0);
  const bills=reservedBills(payday);
  const dailyBudget=monthlyEveryday()/30.4375*days;
  const savings=monthlySavings()/30.4375*days;
  const currentBalance=Number(localStorage.getItem("bmm_manual_balance")||0);
  return {amount:Math.max(0,currentBalance+base-bills-dailyBudget-savings),payday,days};
}
function monthlySafe(){
  const balance=Number(localStorage.getItem("bmm_manual_balance")||0);
  return Math.max(0,balance+monthlyIncome()-monthlyBills()-monthlyEveryday()-monthlySavings()-loggedExpenses());
}
function savingsPlan(goal){
  const remaining=Math.max(0,Number(goal.target_amount||0)-Number(goal.current_amount||0));
  if(!goal.target_date)return null;
  const days=Math.max(1,daysBetween(today(),goal.target_date));
  const months=Math.max(1,days/30.4375),weeks=Math.max(1,days/7);
  const monthly=remaining/months,weekly=remaining/weeks;
  const paychecksPerMonth=cache.income.reduce((s,i)=>s+({
    weekly:52/12,biweekly:26/12,twice_monthly:2,monthly:1
  }[i.frequency]||0),0)||2;
  return {monthly,weekly,perPaycheck:monthly/paychecksPerMonth,remaining,days};
}
function renderAll(){
  const income=monthlyIncome(),bills=monthlyBills(),expenses=loggedExpenses(),savings=monthlySavings();
  const mSafe=monthlySafe(),pSafe=paycheckSafe();
  $("income-total").textContent=money(income);$("bills-total").textContent=money(bills);
  $("expenses-total").textContent=money(expenses);$("savings-total").textContent=money(savings);
  $("safe-monthly").textContent=money(mSafe);$("monthly-safe-card").textContent=money(mSafe);
  $("safe-paycheck").textContent=money(pSafe.amount);$("paycheck-safe-card").textContent=money(pSafe.amount);
  $("next-payday").textContent=pSafe.payday?new Date(pSafe.payday+"T12:00:00").toLocaleDateString():"Add income schedule";
  $("paycheck-explain").textContent=pSafe.payday
    ?`${pSafe.days} days until payday; includes scheduled bills, daily spending and savings reserves.`
    :"Add an income schedule and current balance to calculate this view.";
  const pct=income?Math.min(100,Math.round((bills+expenses+savings)/income*100)):0;
  $("budget-percent").textContent=pct+"%";$("budget-progress").style.width=pct+"%";
  const cats=["Groceries","Gas","Restaurants","Shopping","Other"];
  $("everyday-summary").innerHTML=cats.map(c=>{
    const val=cache.transactions.filter(t=>t.kind==="expense"&&t.category===c&&t.date>=monthStart()&&t.date<=monthEnd())
      .reduce((s,t)=>s+Number(t.amount),0);
    return `<div class="category-item"><small>${c}</small><b>${money(val)}</b></div>`;
  }).join("");
  const upcoming=[...cache.bills].sort((a,b)=>(a.due_date||"").localeCompare(b.due_date||"")).slice(0,5);
  $("upcoming-table").innerHTML=upcoming.length?upcoming.map(b=>
    `<tr><td><b>${safeText(b.name)}</b></td><td>${safeText(b.due_date||"—")}</td><td>${money(b.amount)}</td><td><span class="status ${b.paid?"paid":"due"}">${b.paid?"Paid":"Upcoming"}</span></td></tr>`
  ).join(""):`<tr><td colspan="4" class="empty">No bills added yet.</td></tr>`;
  $("bills-table").innerHTML=cache.bills.map(b=>
    `<tr><td><b>${safeText(b.name)}</b></td><td>${safeText(b.category)}</td><td>${safeText(b.due_date||"—")}</td><td>${safeText(b.frequency)}</td><td>${money(b.amount)}</td><td><button class="text-button" data-edit="bills" data-id="${b.id}">Edit</button> <button class="text-button" data-delete="bills" data-id="${b.id}">Delete</button></td></tr>`
  ).join("")||`<tr><td colspan="6" class="empty">Add your first bill.</td></tr>`;
  $("transactions-table").innerHTML=cache.transactions.map(t=>
    `<tr><td><b>${safeText(t.description)}</b></td><td>${safeText(t.category)}</td><td>${safeText(t.date)}</td><td>${safeText(t.kind)}</td><td>${money(t.amount)}</td><td><button class="text-button" data-delete="transactions" data-id="${t.id}">Delete</button></td></tr>`
  ).join("")||`<tr><td colspan="6" class="empty">No transactions yet.</td></tr>`;
  $("income-table").innerHTML=cache.income.map(i=>
    `<tr><td><b>${safeText(i.source)}</b></td><td>${safeText(i.frequency)}</td><td>${safeText(i.next_payday||"—")}</td><td>${money(i.amount)}</td><td><button class="text-button" data-delete="income" data-id="${i.id}">Delete</button></td></tr>`
  ).join("")||`<tr><td colspan="5" class="empty">Add your income sources.</td></tr>`;
  $("goals-grid").innerHTML=cache.goals.map(g=>{
    const saved=Number(g.current_amount)||0,target=Number(g.target_amount)||0,p=target?Math.min(100,saved/target*100):0;
    const plan=g.goal_type==="spending"?null:savingsPlan(g);
    const planHtml=plan?`<div class="goal-plan"><small>To reach your goal by ${safeText(g.target_date)}:</small><div>Monthly: <b>${money(plan.monthly)}</b></div><div>Weekly: <b>${money(plan.weekly)}</b></div><div>Per paycheck: <b>${money(plan.perPaycheck)}</b></div></div>`:"";
    return `<article class="goal-card"><h3>${safeText(g.name)}</h3><strong>${money(saved)}</strong><small>of ${money(target)} goal · ${Math.round(p)}%</small><div class="progress"><i style="width:${p}%"></i></div><small>Monthly contribution: ${money(g.monthly_contribution||0)}</small>${planHtml}<div class="goal-actions"><button class="text-button" data-quick-add="${g.id}">+ Add savings</button> <button class="text-button" data-edit="goals" data-id="${g.id}">Edit</button> <button class="text-button" data-delete="goals" data-id="${g.id}">Delete</button></div></article>`;
  }).join("")||`<div class="panel empty">No savings goals yet.</div>`;
  $("bank-list").innerHTML=cache.bank_accounts.length
    ?cache.bank_accounts.map(b=>`<p>▣ ${safeText(b.institution_name)} · ${safeText(b.account_mask||"Connected account")}</p>`).join("")
    :"No bank accounts connected.";
}

function checkRenewalReminders(){
  const reminders=cache.bills.filter(b=>b.renewal_date);
  reminders.forEach(b=>{
    const days=daysBetween(today(),b.renewal_date);
    const diff=Math.ceil((new Date(b.renewal_date+"T12:00:00")-new Date(today()+"T12:00:00"))/86400000);
    const windowDays=Math.max(1,Number(b.renewal_reminder_days)||30);
    if(diff<0||diff>windowDays)return;
    const key=`bmm-renewal-${user.id}-${b.id}-${b.renewal_date}`;
    if(localStorage.getItem(key))return;
    const msg=`${b.name} renews ${diff===0?"today":`in ${diff} day(s)`}.`;
    if("Notification" in window&&Notification.permission==="granted"){
      new Notification("Budget My Money renewal reminder",{body:msg});
    }else{
      toast("Renewal reminder: "+msg);
    }
    localStorage.setItem(key,"1");
  });
}

function field(name,label,type="text",opts=null,required=true,value=""){
  const val=value??"";
  let html=`<label class="form-field">${label}`;
  if(opts){
    html+=`<select name="${name}" ${required?"required":""}>${opts.map(o=>`<option value="${safeText(o.value)}" ${String(val)===String(o.value)?"selected":""}>${safeText(o.label)}</option>`).join("")}</select>`;
  }else{
    html+=`<input name="${name}" type="${type}" ${required?"required":""} value="${safeText(val)}" ${type==="number"?'min="0" step="0.01"':""} ${type==="date"?'':""}>`;
  }
  return html+"</label>";
}
const categoryOptions=[..."Housing,Auto,Insurance,Utilities,Credit cards,Subscriptions,Other".split(",").map(x=>({label:x,value:x}))];
const weekdayOptions=[{label:"Sunday",value:0},{label:"Monday",value:1},{label:"Tuesday",value:2},{label:"Wednesday",value:3},{label:"Thursday",value:4},{label:"Friday",value:5},{label:"Saturday",value:6}];
const weekOptions=[{label:"First",value:1},{label:"Second",value:2},{label:"Third",value:3},{label:"Fourth",value:4},{label:"Last",value:5}];

function openForm(type,record=null){
  currentType=type;editingRecord=record;
  const v=record||{};
  const specs={
    bill:{
      title:record?"Edit bill":"Add a bill",
      html:field("name","Bill name","text",null,true,v.name)+
        field("amount","Amount","number",null,true,v.amount)+
        field("due_date","Next due date","date",null,true,v.due_date||today())+
        field("category","Category","text",categoryOptions,true,v.category||"Utilities")+
        field("frequency","Frequency","text",[
          {label:"Monthly",value:"monthly"},{label:"Third Wednesday (monthly)",value:"monthly_nth_weekday"},
          {label:"Weekly",value:"weekly"},{label:"Biweekly",value:"biweekly"},
          {label:"Quarterly",value:"quarterly"},{label:"Yearly",value:"yearly"},{label:"One-time",value:"once"}
        ],true,v.frequency||"monthly")+
        `<div id="nth-weekday-fields" class="form-subgrid"><div class="form-field">${field("recurrence_week","Which week","text",weekOptions,false,v.recurrence_week||3).replace(/^<label class="form-field">/,"<label>").replace(/<\/label>$/,"")}</div><div class="form-field">${field("recurrence_weekday","Day of week","text",weekdayOptions,false,v.recurrence_weekday??3).replace(/^<label class="form-field">/,"<label>").replace(/<\/label>$/,"")}</div></div>`+
        field("renewal_date","Renewal date (optional)","date",null,false,v.renewal_date||"")+
        field("renewal_reminder_days","Remind me this many days before","number",null,false,v.renewal_reminder_days??30)
    },
    transaction:{
      title:"Add transaction",
      html:field("description","Description","text",null,true,v.description)+
        field("amount","Amount","number",null,true,v.amount)+
        field("date","Date","date",null,true,v.date||today())+
        field("kind","Type","text",[{label:"Expense",value:"expense"},{label:"Income",value:"income"}],true,v.kind||"expense")+
        field("category","Category","text",[..."Groceries,Gas,Restaurants,Shopping,Utilities,Entertainment,Health,Other".split(",").map(x=>({label:x,value:x}))],true,v.category||"Other")
    },
    income:{
      title:"Add income source",
      html:field("source","Income source","text",null,true,v.source)+
        field("amount","Take-home paycheck amount","number",null,true,v.amount)+
        field("frequency","Pay frequency","text",[{label:"Weekly",value:"weekly"},{label:"Biweekly",value:"biweekly"},{label:"Twice monthly",value:"twice_monthly"},{label:"Monthly",value:"monthly"}],true,v.frequency||"biweekly")+
        field("next_payday","Next payday","date",null,true,v.next_payday||today())
    },
    goal:{
      title:record?"Edit savings goal":"Add savings goal",
      html:field("name","Goal name","text",null,true,v.name)+
        field("target_amount","Target amount","number",null,true,v.target_amount)+
        field("current_amount","Already saved","number",null,true,v.current_amount??0)+
        field("monthly_contribution","Monthly contribution","number",null,true,v.monthly_contribution??0)+
        field("target_date","Target date (optional)","date",null,false,v.target_date||"")+
        field("goal_type","Goal type","text",[{label:"Savings",value:"savings"},{label:"Everyday spending budget",value:"spending"}],true,v.goal_type||"savings")
    }
  }[type];
  $("dialog-title").textContent=specs.title;
  fields.innerHTML=specs.html;
  fields.style.display="grid";
  fields.style.gridTemplateColumns="repeat(auto-fit,minmax(min(100%,220px),1fr))";
  fields.style.gap="12px";
  fields.querySelectorAll("input,select").forEach(el=>{
    el.style.width="100%";el.style.maxWidth="100%";el.style.boxSizing="border-box";
  });
  dialog.style.width="min(94vw, 640px)";
  dialog.style.maxWidth="94vw";
  dialog.style.maxHeight="85vh";
  $("dialog-error").textContent="";
  const frequency=fields.querySelector('[name="frequency"]');
  const nth=fields.querySelector("#nth-weekday-fields");
  if(nth){
    const sync=()=>{nth.style.display=frequency.value==="monthly_nth_weekday"?"grid":"none";};
    frequency.addEventListener("change",sync);sync();
  }
  if("Notification" in window&&Notification.permission==="default"&&type==="bill"){
    // Permission is requested after the user saves a bill with a renewal date.
  }
  dialog.showModal();
}
$("add-bill-open").onclick=()=>openForm("bill");
$("add-transaction-open").onclick=()=>openForm("transaction");
$("add-income-open").onclick=()=>openForm("income");
$("add-goal-open").onclick=()=>openForm("goal");
$("dialog-close").onclick=$("dialog-cancel").onclick=()=>dialog.close();

$("record-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.target).entries());
  ["amount","target_amount","current_amount","monthly_contribution","renewal_reminder_days","recurrence_week","recurrence_weekday"].forEach(k=>{
    if(data[k]!==undefined&&data[k]!=="")data[k]=Number(data[k]);
    else if(data[k]==="")delete data[k];
  });
  if(currentType==="bill"){
    if(data.frequency==="monthly_nth_weekday"){
      data.recurrence_week=data.recurrence_week||3;
      data.recurrence_weekday=data.recurrence_weekday??3;
    }else{
      delete data.recurrence_week;delete data.recurrence_weekday;
    }
    if(!data.renewal_date){data.renewal_date=null;}
    if(!data.renewal_reminder_days)data.renewal_reminder_days=30;
  }
  const table=({bill:"bills",transaction:"transactions",income:"income",goal:"goals"})[currentType];
  try{
    if(editingRecord)await update(table,editingRecord.id,data);
    else await insert(table,data);
    if(currentType==="bill"&&data.renewal_date&&"Notification" in window&&Notification.permission==="default"){
      try{await Notification.requestPermission();}catch(_){}
    }
    dialog.close();e.target.reset();editingRecord=null;
  }catch(err){$("dialog-error").textContent=err.message;}
});

document.addEventListener("click",async e=>{
  const nav=e.target.closest("[data-view]");
  if(nav){
    document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x===nav));
    document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));
    $("view-"+nav.dataset.view).classList.remove("hidden");
    $("page-title").textContent=nav.querySelector("span").textContent;
  }
  const go=e.target.closest("[data-go]");
  if(go){document.querySelector(`[data-view="${go.dataset.go}"]`).click();}
  const edit=e.target.closest("[data-edit]");
  if(edit){
    const table=edit.dataset.edit,id=edit.dataset.id;
    const record=cache[table]?.find(x=>String(x.id)===String(id));
    if(record)openForm(table==="bills"?"bill":table==="goals"?"goal":table,record);
  }
  const quick=e.target.closest("[data-quick-add]");
  if(quick){
    const goal=cache.goals.find(x=>String(x.id)===String(quick.dataset.quickAdd));
    if(!goal)return;
    const amount=Number(prompt(`How much are you adding to ${goal.name}?`));
    if(!Number.isFinite(amount)||amount<=0){if(amount!==0)toast("Enter an amount greater than zero.");return;}
    try{await update("goals",goal.id,{current_amount:Number(goal.current_amount||0)+amount});}
    catch(err){toast(err.message);}
  }
  const del=e.target.closest("[data-delete]");
  if(del&&confirm("Delete this item?")){
    try{await remove(del.dataset.delete,del.dataset.id);}catch(err){toast(err.message);}
  }
});

$("connect-bank").onclick=async()=>{
  if(!db)return;
  try{
    const {data,error}=await db.functions.invoke("plaid-create-link-token");
    if(error)throw error;
    const handler=Plaid.create({
      token:data.link_token,
      onSuccess:async(public_token,metadata)=>{
        const {error:exchangeError}=await db.functions.invoke("plaid-exchange-public-token",{body:{public_token,metadata}});
        if(exchangeError)toast(exchangeError.message);else{toast("Bank connected");loadAll();}
      },
      onExit:err=>{if(err)toast("Bank connection cancelled");}
    });
    handler.open();
  }catch(err){toast("Bank connection setup needed. See SETUP.md.");}
};

init();
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));
}
