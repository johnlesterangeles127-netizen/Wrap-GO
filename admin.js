import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL  = 'https://khhnivwjupqhthvdzwvi.supabase.co';
const SUPABASE_ANON = 'sb_publishable_TxeVJJdVyJfZsLw16Db4rg_qIcSezWk';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/*
  ── SUPABASE SQL — run once ──────────────────────────────
  (add this table alongside your existing dishes/settings)

  create table orders (
    id bigint generated always as identity primary key,
    name text not null,
    email text not null,
    phone text,
    order_type text default 'pickup',
    address text,
    preferred_date date,
    preferred_time time,
    notes text,
    items jsonb default '[]',
    status text default 'pending',
    created_at timestamptz default now()
  );
  alter table orders enable row level security;
  create policy "Public insert" on orders for insert with check (true);
  create policy "Auth all" on orders for all using (auth.role()='authenticated');
  ────────────────────────────────────────────────────────
*/

let allDishes = [];
let editingId = null;
let ingTags = [], algTags = [];
let siteSettings = {};
let allOrders = [];
let dishSearchTerm = '';
let orderSearchTerm = '';
let realtimeChannel = null;

const CATS = {
  all:'All', salad:'Signature Salads', wraps:'Artisan Wraps',
  sushi:'Sushi Selection', rice:'Rice Meals', drinks:'Drinks & Desserts'
};
const BADGE_LABELS = { new:'New', pop:'Popular', veg:'Vegetarian', spicy:'Spicy', gf:'Gluten-Free' };

// Order lifecycle: pending -> confirmed -> preparing -> ready -> completed (cancel available anytime before completed)
const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];
function nextStatus(current) {
  const idx = STATUS_FLOW.indexOf(current || 'pending');
  return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
}
function statusLabel(status, orderType) {
  if (status === 'ready') return orderType === 'delivery' ? 'Out for Delivery' : 'Ready for Pickup';
  return (status || 'pending').replace(/-/g, ' ');
}
function nextStatusLabel(status, orderType) {
  const n = nextStatus(status);
  if (!n) return null;
  return n === 'ready' ? (orderType === 'delivery' ? 'Out for Delivery' : 'Ready for Pickup') : n.charAt(0).toUpperCase() + n.slice(1);
}

/* ── TOAST ── */
function toast(msg, type = 'success') {
  const w = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `${type === 'success' ? '✓' : '✕'} ${msg}`;
  w.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(20px)'; t.style.transition='.3s'; setTimeout(()=>t.remove(),400); }, 3000);
}

/* ── AUTH ── */
window.doLogin = async function () {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  if (!email || !password) { showLoginError('Please enter your email and password.'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="login-spinner"></span>Signing in…'; errEl.classList.remove('show');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showLoginError(error.message || 'Invalid credentials.'); btn.disabled=false; btn.textContent='Sign In'; return; }
  showAdminApp(data.user);
};
function showLoginError(msg) { const el=document.getElementById('loginError'); el.textContent=msg; el.classList.add('show'); }
document.getElementById('loginPassword').addEventListener('keydown', e => { if(e.key==='Enter') window.doLogin(); });
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  document.getElementById('adminApp').classList.remove('show');
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginEmail').value=''; document.getElementById('loginPassword').value='';
  document.getElementById('loginBtn').textContent='Sign In'; document.getElementById('loginBtn').disabled=false;
});
function showAdminApp(user) {
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('adminApp').classList.add('show');
  document.getElementById('adminUserEmail').textContent=user.email;
  initAdmin();
}
async function checkSession() {
  const { data:{session} } = await sb.auth.getSession();
  if (session) showAdminApp(session.user);
}

/* ── INIT ── */
async function initAdmin() {
  checkDB();
  await Promise.all([loadDishes(), loadSettings(), loadOrders()]);
  startRealtimeOrders();
}

/* ── REALTIME NEW-ORDER ALERTS ──
   Requires the `orders` table to have Realtime enabled in the Supabase
   dashboard (Database → Replication), and relies on the "Auth all" RLS
   policy so this only works while signed in as an admin. */
function startRealtimeOrders() {
  if (realtimeChannel) return;
  realtimeChannel = sb.channel('orders-admin-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
      toast(`New order from ${payload.new?.name || 'a customer'}!`);
      pulseOrdersBadge();
      loadOrders();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
      loadOrders();
    })
    .subscribe();
}
function pulseOrdersBadge() {
  const badge = document.getElementById('resCount');
  if (!badge) return;
  badge.classList.add('pulse');
  setTimeout(() => badge.classList.remove('pulse'), 1500);
}

/* ── DB STATUS ── */
async function checkDB() {
  const el = document.getElementById('dbStatus');
  try { const {error}=await sb.from('dishes').select('id').limit(1); if(error)throw error; el.textContent='● Connected'; el.className='adm-status ok'; }
  catch { el.textContent='● Offline'; el.className='adm-status err'; }
}

/* ── DISHES ── */
async function loadDishes() {
  const { data, error } = await sb.from('dishes').select('*').order('sort_order').order('created_at');
  allDishes = (data && !error) ? data : [];
  updateDashStats();
  document.getElementById('dishCount').textContent = allDishes.length;
}

window.filterDishes = function(term) {
  dishSearchTerm = (term || '').trim().toLowerCase();
  renderAdminDishes();
};

async function renderAdminDishes() {
  const grid = document.getElementById('admDishGrid');
  const filtered = dishSearchTerm
    ? allDishes.filter(d =>
        d.name.toLowerCase().includes(dishSearchTerm) ||
        (CATS[d.category] || d.category || '').toLowerCase().includes(dishSearchTerm))
    : allDishes;

  if (!allDishes.length) { grid.innerHTML=`<div style="color:var(--muted);font-size:.85rem;padding:2rem;">No dishes yet. Click "Add Dish" to start.</div>`; return; }
  if (!filtered.length) { grid.innerHTML=`<div style="color:var(--muted);font-size:.85rem;padding:2rem;">No dishes match "${dishSearchTerm}".</div>`; return; }

  grid.innerHTML = filtered.map(d=>`
    <div class="adm-card">
      <div class="adm-card-img">${d.photo_url?`<img src="${d.photo_url}" alt="${d.name}">`:`<div class="adm-card-img-ph">${d.emoji||'🥗'}</div>`}</div>
      <div class="adm-card-body">
        <div class="adm-card-cat">${CATS[d.category]||d.category}</div>
        <div class="adm-card-name">${d.name}</div>
        <div class="adm-card-price">${d.price||''}</div>
        <div class="adm-avail-toggle">
          <label class="toggle-sw"><input type="checkbox" ${d.available!==false?'checked':''} onchange="toggleAvail('${d.id}',this.checked)"><div class="toggle-track"></div></label>
          <label>${d.available!==false?'Available':'Hidden'}</label>
        </div>
        <div class="adm-card-actions">
          <button class="btn-adm-edit" onclick="editDish('${d.id}')">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:.3rem;"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Edit
          </button>
          <button class="btn-adm-del" onclick="deleteDish('${d.id}','${d.name.replace(/'/g,"\\'")}')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    </div>`).join('');
}

window.editDish = id => { const d=allDishes.find(x=>String(x.id)===String(id)); if(d) openDishForm(d); };
window.deleteDish = async (id, name) => {
  if (!confirm(`Delete "${name}"?`)) return;
  const {error}=await sb.from('dishes').delete().eq('id',id);
  if(!error){toast('Dish deleted');await loadDishes();renderAdminDishes();}else toast('Delete failed','error');
};
window.toggleAvail = async (id, val) => {
  const {error}=await sb.from('dishes').update({available:val}).eq('id',id);
  if(!error){toast(val?'Dish is now visible':'Dish hidden');await loadDishes();}else toast('Update failed','error');
};

/* ── DISH FORM ── */
window.openDishForm = function(dish=null) {
  editingId=dish?dish.id:null;
  ingTags=dish?(Array.isArray(dish.ingredients)?dish.ingredients.map(i=>typeof i==='string'?i:`${i.e||''} ${i.n||i}`):[]): [];
  algTags=dish?(Array.isArray(dish.allergens)?dish.allergens:[]):[];
  document.getElementById('formTitle').textContent=dish?'Edit Dish':'Add New Dish';
  ['name','category','price','emoji','tagline','description','calories','rating','protein','carbs','fat','reviews'].forEach(f=>{const el=document.getElementById('f-'+f);if(el)el.value=dish?dish[f]||'':'';});
  const availCb=document.getElementById('f-available');
  const availLbl=document.getElementById('f-avail-label');
  availCb.checked=dish?dish.available!==false:true;
  availLbl.textContent=availCb.checked?'Visible to customers':'Hidden from menu';
  availCb.onchange=()=>{availLbl.textContent=availCb.checked?'Visible to customers':'Hidden from menu';};
  document.getElementById('f-photoUrl').value=dish?.photo_url||'';
  const prev=document.getElementById('photoPreview');
  if(dish?.photo_url){prev.src=dish.photo_url;prev.classList.add('show');}else{prev.src='';prev.classList.remove('show');}
  document.querySelectorAll('.badge-cb').forEach(cb=>{cb.checked=dish?.badges?.includes(cb.value)||false;});
  renderTags('ingredients'); renderTags('allergens');
  document.getElementById('dishFormBg').classList.add('show');
};
window.closeDishForm=()=>{document.getElementById('dishFormBg').classList.remove('show');editingId=null;ingTags=[];algTags=[];};
window.handleTagKey=(e,type)=>{
  if(e.key!=='Enter'&&e.key!==',')return; e.preventDefault();
  const val=e.target.value.trim(); if(!val)return;
  if(type==='ingredients')ingTags.push(val);else algTags.push(val);
  e.target.value=''; renderTags(type);
};
function renderTags(type) {
  const tags=type==='ingredients'?ingTags:algTags;
  const wrapId=type==='ingredients'?'ingTagWrap':'algTagWrap';
  const inputId=type==='ingredients'?'ingTagInput':'algTagInput';
  const wrap=document.getElementById(wrapId), input=document.getElementById(inputId);
  wrap.innerHTML='';
  tags.forEach((t,i)=>{const tag=document.createElement('span');tag.className='tag';tag.innerHTML=`${t} <button class="tag-del" onclick="removeTag('${type}',${i})">×</button>`;wrap.appendChild(tag);});
  wrap.appendChild(input);
}
window.removeTag=(type,i)=>{if(type==='ingredients')ingTags.splice(i,1);else algTags.splice(i,1);renderTags(type);};
window.handlePhotoUpload=async(input)=>{
  const file=input.files[0]; if(!file)return;
  if(file.size>5*1024*1024){toast('File too large (max 5MB)','error');return;}
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['jpg','jpeg','png','webp','gif'].includes(ext)){toast('Unsupported file type','error');return;}
  toast('Uploading photo…');
  const fname=`dish-${Date.now()}.${ext}`;
  const {error:uploadError}=await sb.storage.from('dish-photos').upload(fname,file,{upsert:true,contentType:file.type});
  if(uploadError){toast('Upload failed: '+uploadError.message,'error');return;}
  const {data:urlData}=sb.storage.from('dish-photos').getPublicUrl(fname);
  if(!urlData?.publicUrl){toast('Could not get public URL','error');return;}
  const prev=document.getElementById('photoPreview');
  document.getElementById('f-photoUrl').value=urlData.publicUrl;
  prev.src=urlData.publicUrl+'?t='+Date.now(); prev.classList.add('show');
  toast('Photo uploaded!');
};
window.saveDish=async()=>{
  const name=document.getElementById('f-name').value.trim();
  const category=document.getElementById('f-category').value;
  if(!name||!category){toast('Name and category are required','error');return;}
  const badges=[...document.querySelectorAll('.badge-cb:checked')].map(c=>c.value);
  const parseIng=tag=>{const parts=tag.trim().split(' ');if(parts.length>=2&&/^\p{Emoji}/u.test(parts[0]))return{e:parts[0],n:parts.slice(1).join(' ')};return{e:'🥗',n:tag};};
  const payload={name,category,price:document.getElementById('f-price').value,emoji:document.getElementById('f-emoji').value||'🥗',tagline:document.getElementById('f-tagline').value,description:document.getElementById('f-description').value,calories:document.getElementById('f-calories').value,protein:document.getElementById('f-protein').value,carbs:document.getElementById('f-carbs').value,fat:document.getElementById('f-fat').value,rating:parseFloat(document.getElementById('f-rating').value)||5.0,reviews:parseInt(document.getElementById('f-reviews').value)||0,ingredients:ingTags.map(parseIng),allergens:algTags,badges,photo_url:document.getElementById('f-photoUrl').value||null,available:document.getElementById('f-available').checked};
  let error;
  if(editingId){({error}=await sb.from('dishes').update(payload).eq('id',editingId));}
  else{({error}=await sb.from('dishes').insert(payload));}
  if(!error){toast(editingId?'Dish updated!':'Dish added!');closeDishForm();await loadDishes();renderAdminDishes();}
  else toast('Save failed: '+error.message,'error');
};

/* ── ORDERS ── */
async function loadOrders() {
  const { data } = await sb.from('orders').select('*').order('created_at', { ascending: false });
  allOrders = data || [];
  renderOrdersTable();
  updateDashStats();
  document.getElementById('resCount').textContent = allOrders.length;
}

window.filterOrders = function(term) {
  orderSearchTerm = (term || '').trim().toLowerCase();
  renderOrdersTable();
};

function renderOrdersTable() {
  const tbody = document.getElementById('resTableBody');
  const filtered = orderSearchTerm
    ? allOrders.filter(o =>
        (o.name || '').toLowerCase().includes(orderSearchTerm) ||
        (o.email || '').toLowerCase().includes(orderSearchTerm) ||
        (o.phone || '').toLowerCase().includes(orderSearchTerm) ||
        String(o.id).includes(orderSearchTerm))
    : allOrders;

  if (!allOrders.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:2rem;">No orders yet.</td></tr>`;
    return;
  }
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:2rem;">No orders match "${orderSearchTerm}".</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(o => {
    const items = Array.isArray(o.items) ? o.items : [];
    const itemSummary = items.map(i => `${i.name} ×${i.qty}`).join(', ') || '—';
    const when = [o.preferred_date, o.preferred_time].filter(Boolean).join(' ') || '—';
    const status = o.status || 'pending';
    const nLabel = nextStatusLabel(status, o.order_type);
    return `<tr>
      <td>#${o.id} ${o.name}<br><small style="color:var(--muted)">${o.email}</small></td>
      <td><span class="res-status rs-${o.order_type==='delivery'?'delivery':'pickup'}">${o.order_type||'pickup'}</span></td>
      <td style="max-width:180px;font-size:.72rem;">${itemSummary}</td>
      <td style="font-size:.72rem;">${o.phone||'—'}<br>${o.address||''}</td>
      <td style="font-size:.72rem;">${when}</td>
      <td><span class="res-status rs-${status}">${statusLabel(status, o.order_type)}</span></td>
      <td style="display:flex;gap:.4rem;flex-wrap:wrap;">
        ${nLabel && status!=='cancelled' ? `<button class="btn-rs btn-rs-advance" onclick="updateOrder(${o.id},'${nextStatus(status)}')">${nLabel}</button>` : ''}
        ${status!=='cancelled' && status!=='completed' ? `<button class="btn-rs btn-rs-cancel" onclick="updateOrder(${o.id},'cancelled')">Cancel</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

window.updateOrder = async (id, status) => {
  const {error}=await sb.from('orders').update({status}).eq('id',id);
  if(!error){toast(`Order ${status}`);await loadOrders();}else toast('Update failed','error');
};
window.clearCancelledRes = async () => {
  const {error}=await sb.from('orders').delete().eq('status','cancelled');
  if(!error){toast('Cancelled orders cleared');await loadOrders();}
};

/* ── SETTINGS ── */
async function loadSettings() {
  const {data,error}=await sb.from('settings').select('*');
  if(error||!data)return;
  siteSettings=Object.fromEntries(data.map(r=>[r.key,r.value]));
  ['name','tagline','address','email','phone','instagram','facebook','hours_weekday','hours_saturday','hours_sunday','hero_sub','footer_tag'].forEach(k=>{const el=document.getElementById('s-'+k);if(el&&siteSettings[k])el.value=siteSettings[k];});
}
window.saveSettings=async(keys)=>{
  for(const k of keys){const el=document.getElementById('s-'+k);if(!el)continue;const{error}=await sb.from('settings').upsert({key:k,value:el.value},{onConflict:'key'});if(!error)siteSettings[k]=el.value;}
  toast('Settings saved!');
};

/* ── DASHBOARD ── */
function updateDashStats() {
  document.getElementById('ds-dishes').textContent=allDishes.length;
  document.getElementById('ds-avail').textContent=allDishes.filter(d=>d.available!==false).length;
  document.getElementById('ds-res').textContent=allOrders.length;
  const pending=allOrders.filter(r=>r.status==='pending').length;
  document.getElementById('ds-pending-lbl').textContent=pending+' pending review';
  document.getElementById('ds-cats').textContent=new Set(allDishes.map(d=>d.category)).size;
}

/* ── SIDEBAR ── */
document.querySelectorAll('.adm-sb-item').forEach(item=>{item.addEventListener('click',()=>switchSec(item.dataset.sec));});
window.switchSec=sec=>{
  document.querySelectorAll('.adm-sb-item').forEach(i=>i.classList.toggle('on',i.dataset.sec===sec));
  document.querySelectorAll('.adm-section').forEach(s=>s.classList.toggle('on',s.id==='sec-'+sec));
  if(sec==='dishes')renderAdminDishes();
  if(sec==='reservations')loadOrders();
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDishForm();});

checkSession();
