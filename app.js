/* Budget My Money - Supabase-backed PWA.
   Configure SUPABASE_URL and SUPABASE_ANON_KEY before use. */
const SUPABASE_URL = "https://bdrjwmkegxcyicgujesb.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "sb_publishable_txlklLg5PURA10L37XzMKA_RythylvJ";
const $ = (id) => document.getElementById(id);
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.includes("YOUR_");
let db = null, user = null, authMode = "login", currentType = null;
let cache = { bills: [], income: [], transactions: [], goals: [], bank_accounts: [] };
const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n)||0);
const today = () => new Date().toISOString().slice(0,10);
const monthStart = () => new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);
const monthEnd = () => new Date(new Date().getFullYear(),new Date().getMonth()+1,0).toISOString().slice(0,10);
const frequencyMonthly = (amount, f) => ({weekly:amount*52/12,biweekly:amount*26/12,monthly:amount,quarterly:amount/3,yearly:amount/12,once:0}[f] ?? amount);
function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2600)}
function safeText(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showAuth(){ $("auth").classList.remove("hidden");$("app").classList.add("hidden"); }
function showApp(){ $("auth").classList.add("hidden");$("app").classList.remove("hidden");$("user-email").textContent=user.email;loadAll(); }
async function init(){
  $("today-label").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}).toUpperCase();
  if(!configured){$("auth-message").textContent="Setup required: add your Supabase URL and anon key in app.js, then run the SQL in supabase/schema.sql.";return}
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:{session}}=await db.auth.getSession(); if(session){user=session.user;showApp()}else showAuth();
  db.auth.onAuthStateChange((_event,session)=>{if(session){user=session.user;showApp()}else{user=null;showAuth()}});
}
document.querySelectorAll("[data-auth]").forEach(b=>b.addEventListener("click",()=>{authMode=b.dataset.auth;document.querySelectorAll("[data-auth]").forEach(x=>x.classList.toggle("active",x===b));$("auth-submit").textContent=authMode==="login"?"Sign in":"Create account";$("password").autocomplete=authMode==="login"?"current-password":"new-password"}));
$("auth-form").addEventListener("submit",async e=>{e.preventDefault();if(!db){$("auth-message").textContent="Configure Supabase first. See SETUP.md.";return}const email=$("email").value,password=$("password").value;$("auth-submit").disabled=true;let result=authMode==="login"?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password});$("auth-submit").disabled=false;if(result.error)$("auth-message").textContent=result.error.message;else if(authMode==="signup"&&!result.data.session)$("auth-message").textContent="Check your email to confirm your account, then sign in.";else toast("Welcome to Budget My Money")});
$("signout").onclick=async()=>{await db.auth.signOut();};
async function loadAll(){
  if(!db||!user)return;
  const tables=["bills","income","transactions","goals","bank_accounts"];
  const results=await Promise.all(tables.map(t=>db.from(t).select("*").order("created_at",{ascending:false})));
  for(let i=0;i<tables.length;i++){if(results[i].error){console.error(results[i].error);toast("Could not load "+tables[i]);continue}cache[tables[i]]=results[i].data||[]}
  renderAll();
}
async function insert(table,row){const {error}=await db.from(table).insert({...row,user_id:user.id});if(error)throw error;await loadAll();toast("Saved securely");}
async function remove(table,id){const {error}=await db.from(table).delete().eq("id",id);if(error)throw error;await loadAll();toast("Deleted");}
function monthlyIncome(){return cache.income.reduce((s,x)=>s+frequencyMonthly(Number(x.amount),x.frequency),0)}
function monthlyBills(){return cache.bills.reduce((s,x)=>s+frequencyMonthly(Number(x.amount),x.frequency),0)}
function monthlyEveryday(){return cache.goals.filter(g=>g.goal_type==="spending").reduce((s,g)=>s+Number(g.monthly_budget||0),0)}
function monthlySavings(){return cache.goals.filter(g=>g.goal_type!=="spending").reduce((s,g)=>s+Number(g.monthly_contribution||0),0)}
function loggedExpenses(){return cache.transactions.filter(t=>t.kind==="expense"&&t.date>=monthStart()&&t.date<=monthEnd()).reduce((s,t)=>s+Number(t.amount),0)}
function nextPayday(){
  const dates=cache.income.map(i=>i.next_payday).filter(d=>d&&d>=today()).sort();return dates[0]||null;
}
function reservedBills(until){
  return cache.bills.reduce((s,b)=>{if(!b.due_date)return s;let d=new Date(b.due_date+"T12:00:00");const end=new Date(until+"T23:59:59");let amount=Number(b.amount)||0;if(b.frequency==="monthly"){while(d<new Date(today()+"T00:00:00"))d.setMonth(d.getMonth()+1);while(d<=end){s+=amount;d.setMonth(d.getMonth()+1)}}else if(d>=new Date(today()+"T00:00:00")&&d<=end){s+=amount}return s},0)
}
function daysBetween(a,b){return Math.max(1,Math.ceil((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/86400000))}
function paycheckSafe(){
  const payday=nextPayday();if(!payday)return {amount:0,payday:null,days:0};
  const days=daysBetween(today(),payday),base=cache.income.filter(i=>i.next_payday===payday).reduce((s,i)=>s+Number(i.amount),0);
  const bills=reservedBills(payday),dailyBudget=monthlyEveryday()/30.4375*days,savings=monthlySavings()/30.4375*days;
  const currentBalance=Number(localStorage.getItem("bmm_manual_balance")||0);
  return {amount:Math.max(0,currentBalance+base-bills-dailyBudget-savings),payday,days};
}
function monthlySafe(){
  const balance=Number(localStorage.getItem("bmm_manual_balance")||0);
  const income=monthlyIncome(),bills=monthlyBills(),everyday=Math.max(monthlyEveryday(),0),savings=monthlySavings();
  return Math.max(0,balance+income-bills-everyday-savings-loggedExpenses());
}
function renderAll(){
  const income=monthlyIncome(),bills=monthlyBills(),expenses=loggedExpenses(),savings=monthlySavings(),mSafe=monthlySafe(),pSafe=paycheckSafe();
  $("income-total").textContent=money(income);$("bills-total").textContent=money(bills);$("expenses-total").textContent=money(expenses);$("savings-total").textContent=money(savings);
  $("safe-monthly").textContent=money(mSafe);$("monthly-safe-card").textContent=money(mSafe);$("safe-paycheck").textContent=money(pSafe.amount);$("paycheck-safe-card").textContent=money(pSafe.amount);
  $("next-payday").textContent=pSafe.payday?new Date(pSafe.payday+"T12:00:00").toLocaleDateString():"Add income schedule";
  $("paycheck-explain").textContent=pSafe.payday?`${pSafe.days} days until payday; includes scheduled bills, daily spending and savings reserves.`:"Add an income schedule and current balance to calculate this view.";
  const pct=income?Math.min(100,Math.round((bills+expenses+savings)/income*100)):0;$("budget-percent").textContent=pct+"%";$("budget-progress").style.width=pct+"%";
  const cats=["Groceries","Gas","Restaurants","Shopping","Other"];const categoryHtml=cats.map(c=>{const val=cache.transactions.filter(t=>t.kind==="expense"&&t.category===c&&t.date>=monthStart()&&t.date<=monthEnd()).reduce((s,t)=>s+Number(t.amount),0);return `<div class="category-item"><small>${c}</small><b>${money(val)}</b></div>`}).join("");$("everyday-summary").innerHTML=categoryHtml;
  const upcoming=[...cache.bills].sort((a,b)=>(a.due_date||"").localeCompare(b.due_date||"")).slice(0,5);$("upcoming-table").innerHTML=upcoming.length?upcoming.map(b=>`<tr><td><b>${safeText(b.name)}</b></td><td>${safeText(b.due_date||"—")}</td><td>${money(b.amount)}</td><td><span class="status ${b.paid?"paid":"due"}">${b.paid?"Paid":"Upcoming"}</span></td></tr>`).join(""):`<tr><td colspan="4" class="empty">No bills added yet.</td></tr>`;
  $("bills-table").innerHTML=cache.bills.map(b=>`<tr><td><b>${safeText(b.name)}</b></td><td>${safeText(b.category)}</td><td>${safeText(b.due_date||"—")}</td><td>${safeText(b.frequency)}</td><td>${money(b.amount)}</td><td><button class="text-button" data-delete="bills" data-id="${b.id}">Delete</button></td></tr>`).join("")||`<tr><td colspan="6" class="empty">Add your first bill.</td></tr>`;
  $("transactions-table").innerHTML=cache.transactions.map(t=>`<tr><td><b>${safeText(t.description)}</b></td><td>${safeText(t.category)}</td><td>${safeText(t.date)}</td><td>${safeText(t.kind)}</td><td>${money(t.amount)}</td><td><button class="text-button" data-delete="transactions" data-id="${t.id}">Delete</button></td></tr>`).join("")||`<tr><td colspan="6" class="empty">No transactions yet.</td></tr>`;
  $("income-table").innerHTML=cache.income.map(i=>`<tr><td><b>${safeText(i.source)}</b></td><td>${safeText(i.frequency)}</td><td>${safeText(i.next_payday||"—")}</td><td>${money(i.amount)}</td><td><button class="text-button" data-delete="income" data-id="${i.id}">Delete</button></td></tr>`).join("")||`<tr><td colspan="5" class="empty">Add your income sources.</td></tr>`;
  $("goals-grid").innerHTML=cache.goals.map(g=>{const saved=Number(g.current_amount)||0,target=Number(g.target_amount)||0,p=target?Math.min(100,saved/target*100):0;return `<article class="goal-card"><h3>${safeText(g.name)}</h3><strong>${money(saved)}</strong><small>of ${money(target)} goal · ${Math.round(p)}%</small><div class="progress"><i style="width:${p}%"></i></div><small>Monthly contribution: ${money(g.monthly_contribution||0)}</small><button class="text-button" data-delete="goals" data-id="${g.id}">Delete goal</button></article>`}).join("")||`<div class="panel empty">No savings goals yet.</div>`;
  $("bank-list").innerHTML=cache.bank_accounts.length?cache.bank_accounts.map(b=>`<p>▣ ${safeText(b.institution_name)} · ${safeText(b.account_mask||"Connected account")}</p>`).join(""):"No bank accounts connected.";
}
document.addEventListener("click",async e=>{
  const nav=e.target.closest("[data-view]");if(nav){document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x===nav));document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));$("view-"+nav.dataset.view).classList.remove("hidden");$("page-title").textContent=nav.querySelector("span").textContent}
  const go=e.target.closest("[data-go]");if(go){document.querySelector(`[data-view="${go.dataset.go}"]`).click()}
  const del=e.target.closest("[data-delete]");if(del&&confirm("Delete this item?")){try{await remove(del.dataset.delete,del.dataset.id)}catch(err){toast(err.message)}}
});
const dialog=$("record-dialog"),fields=$("dialog-fields");
function field(name,label,type="text",opts=null,required=true){let html=`<label>${label}`;if(opts){html+=`<select name="${name}" ${required?"required":""}>${opts.map(o=>`<option value="${o.value}">${o.label}</option>`).join("")}</select>`}else html+=`<input name="${name}" type="${type}" ${required?"required":""} ${type==="number"?'min="0" step="0.01"':""} ${type==="date"?'value="'+today()+'"':""}>`;return html+"</label>"}
function openForm(type){currentType=type;const specs={
bill:{title:"Add a bill",html:field("name","Bill name")+field("amount","Amount","number")+field("due_date","Next due date","date")+field("category","Category",null,[..."Housing,Auto,Insurance,Utilities,Credit cards,Subscriptions,Other".split(",").map(x=>({label:x,value:x}))])+field("frequency","Frequency",null,[{label:"Monthly",value:"monthly"},{label:"Weekly",value:"weekly"},{label:"Biweekly",value:"biweekly"},{label:"Quarterly",value:"quarterly"},{label:"Yearly",value:"yearly"},{label:"One-time",value:"once"}])},
transaction:{title:"Add transaction",html:field("description","Description")+field("amount","Amount","number")+field("date","Date","date")+field("kind","Type",null,[{label:"Expense",value:"expense"},{label:"Income",value:"income"}])+field("category","Category",null,[..."Groceries,Gas,Restaurants,Shopping,Utilities,Entertainment,Health,Other".split(",").map(x=>({label:x,value:x}))])},
income:{title:"Add income source",html:field("source","Income source")+field("amount","Take-home paycheck amount","number")+field("frequency","Pay frequency",null,[{label:"Weekly",value:"weekly"},{label:"Biweekly",value:"biweekly"},{label:"Twice monthly",value:"twice_monthly"},{label:"Monthly",value:"monthly"}])+field("next_payday","Next payday","date")},
goal:{title:"Add savings goal",html:field("name","Goal name")+field("target_amount","Target amount","number")+field("current_amount","Already saved","number")+field("monthly_contribution","Monthly contribution","number")+field("goal_type","Goal type",null,[{label:"Savings",value:"savings"},{label:"Everyday spending budget",value:"spending"}])}
}[type];$("dialog-title").textContent=specs.title;fields.innerHTML=specs.html;$("dialog-error").textContent="";dialog.showModal();}
$("add-bill-open").onclick=()=>openForm("bill");$("add-transaction-open").onclick=()=>openForm("transaction");$("add-income-open").onclick=()=>openForm("income");$("add-goal-open").onclick=()=>openForm("goal");$("dialog-close").onclick=$("dialog-cancel").onclick=()=>dialog.close();
$("record-form").addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());["amount","target_amount","current_amount","monthly_contribution"].forEach(k=>{if(data[k]!==undefined)data[k]=Number(data[k])});try{await insert(({bill:"bills",transaction:"transactions",income:"income",goal:"goals"})[currentType],data);dialog.close();e.target.reset()}catch(err){$("dialog-error").textContent=err.message}});
$("connect-bank").onclick=async()=>{if(!db)return;try{const {data,error}=await db.functions.invoke("plaid-create-link-token");if(error)throw error;const handler=Plaid.create({token:data.link_token,onSuccess:async(public_token,metadata)=>{const {error:exchangeError}=await db.functions.invoke("plaid-exchange-public-token",{body:{public_token,metadata}});if(exchangeError)toast(exchangeError.message);else{toast("Bank connected");loadAll()}},onExit:err=>{if(err)toast("Bank connection cancelled")}});handler.open()}catch(err){toast("Bank connection setup needed. See SETUP.md.")}};
init();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));
