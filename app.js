const SUPABASE_URL  = 'https://khhnivwjupqhthvdzwvi.supabase.co';
const SUPABASE_ANON = 'sb_publishable_TxeVJJdVyJfZsLw16Db4rg_qIcSezWk';

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ════════════════════════════════
   STATE
   ════════════════════════════════ */
let allDishes = [];
let siteSettings = {};
const CART_KEY = 'wrapgo_cart_v1';
let cart = loadCartFromStorage(); // { dishId: quantity }

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveCartToStorage() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
}

const CATS = {
  all:'All',
  salad:'Signature Salads',
  wraps:'Artisan Wraps',
  sushi:'Sushi Selection',
  rice:'Rice Meals',
  drinks:'Drinks & Desserts'
};
const BADGE_LABELS = { new:'New', pop:'Popular', veg:'Vegetarian', spicy:'Spicy', gf:'Gluten-Free' };
const DEFAULT_ORBIT = ['🥗','🥑','🍋','🌿','🌯','🍣','🫛','🥕'];

/* ════════════════════════════════
   TOAST
   ════════════════════════════════ */
function toast(msg, type = 'success') {
  const w = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `${type === 'success' ? '✓' : '✕'} ${msg}`;
  w.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(20px)';
    t.style.transition = '.3s';
    setTimeout(() => t.remove(), 400);
  }, 3000);
}

/* ════════════════════════════════
   PUBLIC MENU
   ════════════════════════════════ */
async function loadDishes() {
  const { data, error } = await sb.from('dishes').select('*').order('sort_order').order('created_at');
  if (error) { console.error('Supabase error:', error.message); allDishes = []; }
  else allDishes = data || [];
  // Drop any cart items pointing at dishes that no longer exist or are unavailable
  let cartChanged = false;
  Object.keys(cart).forEach(id => {
    const d = allDishes.find(x => String(x.id) === String(id));
    if (!d || d.available === false) { delete cart[id]; cartChanged = true; }
  });
  if (cartChanged) saveCartToStorage();
  renderPublicMenu('all');
  buildCatTabs();
  buildMarquee();
  renderOrderPicker();
  renderCart();
}

function renderPublicMenu(filter) {
  const grid = document.getElementById('menuGrid');
  const dishes = filter === 'all'
    ? allDishes.filter(d => d.available)
    : allDishes.filter(d => d.category === filter && d.available);
  if (!dishes.length) {
    grid.innerHTML = `<div class="menu-empty"><div class="me-icon">🥗</div><p>${filter === 'all' ? 'Menu coming soon — check back shortly!' : 'No dishes in this category yet.'}</p></div>`;
    return;
  }
  grid.innerHTML = dishes.map(d => buildDishCard(d)).join('');
  grid.querySelectorAll('.dcard').forEach(c => {
    c.addEventListener('click', () => openModal(c.dataset.id));
  });
  observeReveal();
}

function buildDishCard(d) {
  const ings = Array.isArray(d.ingredients) ? d.ingredients : [];
  const badges = Array.isArray(d.badges) ? d.badges : [];
  const showChips = ings.slice(0, 4).map(i => {
    const label = typeof i === 'string' ? i : `${i.e || ''} ${i.n || i}`;
    return `<span class="dchip">${label}</span>`;
  }).join('') + (ings.length > 4 ? `<span class="dchip">+${ings.length - 4} more</span>` : '');
  const orbitEmojis = ings.length ? ings.map(i => typeof i === 'string' ? i.split(' ')[0] : (i.e || '🥗')) : DEFAULT_ORBIT;
  const photoHTML = d.photo_url
    ? `<img src="${d.photo_url}" alt="${d.name}" loading="lazy" onerror="this.style.display='none';">`
    : `<div class="dph">${buildOrbit(orbitEmojis)}<div style="position:relative;z-index:2;text-align:center;"><div class="dph-emoji">${d.emoji || '🥗'}</div><div class="dph-lbl">Tap to see details</div></div></div>`;
  const badgesHTML = badges.map(b => `<span class="dbadge b-${b}">${BADGE_LABELS[b] || b}</span>`).join('');
  return `<div class="dcard${d.available === false ? ' unavail' : ''}" data-id="${d.id}">
    <div class="dphoto">
      ${photoHTML}
      <div class="dbadges">${badgesHTML}</div>
      ${d.calories ? `<span class="dcal">${d.calories}</span>` : ''}
      ${d.available === false ? '<div class="dunavail-overlay"><span>Currently Unavailable</span></div>' : ''}
    </div>
    <div class="dbody">
      <div class="dcat">${CATS[d.category] || d.category}</div>
      <div class="dname">${d.name}</div>
      <div class="drating"><span class="stars">${starStr(d.rating || 5)}</span><span class="rcount">${d.rating || 5} (${d.reviews || 0} reviews)</span></div>
      <p class="dtagline">${d.tagline || ''}</p>
      <div class="dchips">${showChips}</div>
      <div class="dfoot">
        <div class="dprice">${d.price || ''} <small>/ serving</small></div>
        <button class="btn-detail">Full Details</button>
      </div>
    </div>
  </div>`;
}

function buildOrbit(emojis) {
  const outer = emojis.slice(0, 4);
  const inner = emojis.slice(4, 8);
  let html = `<div class="orbit-wrap"><div class="orb-ring r1"></div><div class="orb-ring r2"></div>`;
  outer.forEach((e, i) => {
    const angle = (360 / outer.length) * i, spd = (10 + i * 2.5) + 's';
    html += `<div class="orb-item" style="--od:${spd};transform:rotate(${angle}deg)"><div class="orb-item-inner" style="--or:80px;--od:${spd}">${e}</div></div>`;
  });
  inner.forEach((e, i) => {
    const angle = (360 / inner.length) * i + 45, spd = (7 + i * 2) + 's';
    html += `<div class="orb-item rev" style="--od:${spd};transform:rotate(${angle}deg)"><div class="orb-item-inner" style="--or:50px;--od:${spd}">${e}</div></div>`;
  });
  return html + '</div>';
}

function starStr(r) {
  const val = Math.min(5, Math.max(0, parseFloat(r) || 0));
  const full = Math.floor(val), half = (val % 1) >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

function buildCatTabs() {
  const cats = ['all', ...new Set(allDishes.map(d => d.category))];
  const wrap = document.getElementById('catTabs');
  wrap.innerHTML = cats.map(c => `<button class="ctab${c === 'all' ? ' on' : ''}" data-cat="${c}">${CATS[c] || c}</button>`).join('');
  wrap.querySelectorAll('.ctab').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.ctab').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      renderPublicMenu(btn.dataset.cat);
    });
  });
}

function buildMarquee() {
  const names = allDishes.length
    ? allDishes.map(d => d.name)
    : ['Signature Salads','Artisan Wraps','Sushi Selection','Rice Meals','Fresh Daily','Made to Order','Wrap & Go'];
  const doubled = [...names, ...names].map(n => `<span class="mqi">${n}<span class="mqd">✦</span></span>`).join('');
  document.getElementById('mqTrack').innerHTML = doubled;
}

/* ════════════════════════════════
   DISH MODAL
   ════════════════════════════════ */
function openModal(id) {
  const d = allDishes.find(x => String(x.id) === String(id));
  if (!d) return;
  const ings = Array.isArray(d.ingredients) ? d.ingredients : [];
  const algs = Array.isArray(d.allergens) ? d.allergens : [];
  const badges = Array.isArray(d.badges) ? d.badges : [];
  const orbitEmojis = ings.map(i => typeof i === 'string' ? i.split(' ')[0] : (i.e || '🥗'));
  const qty = cart[d.id] || 0;

  document.getElementById('mImg').innerHTML = d.photo_url
    ? `<img src="${d.photo_url}" alt="${d.name}">
       <div class="m-mbadges">${badges.map(b => `<span class="dbadge b-${b}">${BADGE_LABELS[b] || b}</span>`).join('')}</div>
       ${d.calories ? `<span class="m-cal">${d.calories}</span>` : ''}
       <button class="m-close" onclick="closeModal()">✕</button>`
    : `<div class="m-img-ph">
        ${buildOrbit(orbitEmojis.length ? orbitEmojis : DEFAULT_ORBIT)}
        <div style="position:relative;z-index:3;text-align:center;"><div class="mph-em">${d.emoji || '🥗'}</div><div class="mph-lb">Photo coming soon</div></div>
        <div class="m-mbadges">${badges.map(b => `<span class="dbadge b-${b}">${BADGE_LABELS[b] || b}</span>`).join('')}</div>
        ${d.calories ? `<span class="m-cal">${d.calories}</span>` : ''}
       </div>
       <button class="m-close" onclick="closeModal()">✕</button>`;

  document.getElementById('mBody').innerHTML = `
    <div><div class="m-mcat">${CATS[d.category] || d.category}</div><div class="m-mname">${d.name}</div></div>
    <div class="m-mrating"><span class="stars">${starStr(d.rating)}</span><span>${d.rating} · ${d.reviews} reviews</span></div>
    ${d.description ? `<p class="m-mdesc">${d.description}</p>` : ''}
    ${ings.length ? `<div><div class="m-label">Full Ingredients</div><div class="m-ing-grid">${ings.map(i => {
      if (typeof i === 'string') return `<div class="m-ing-chip">${i}</div>`;
      return `<div class="m-ing-chip"><span>${i.e || ''}</span>${i.n || i}</div>`;
    }).join('')}</div></div>` : ''}
    ${(d.calories || d.protein) ? `<div><div class="m-label">Nutrition Per Serving</div><div class="m-nutgrid">
      ${d.calories ? `<div class="m-nutbox"><div class="m-nutval">${d.calories.replace(' kcal','')}</div><div class="m-nutlbl">Calories</div></div>` : ''}
      ${d.protein ? `<div class="m-nutbox"><div class="m-nutval">${d.protein}</div><div class="m-nutlbl">Protein</div></div>` : ''}
      ${d.carbs ? `<div class="m-nutbox"><div class="m-nutval">${d.carbs}</div><div class="m-nutlbl">Carbs</div></div>` : ''}
      ${d.fat ? `<div class="m-nutbox"><div class="m-nutval">${d.fat}</div><div class="m-nutlbl">Fat</div></div>` : ''}
    </div></div>` : ''}
    ${algs.length ? `<div><div class="m-label">Allergens</div><div class="m-allergens">${algs.map(a => `<span class="m-allergen">⚠ ${a}</span>`).join('')}</div></div>` : ''}
    <div class="m-foot">
      <div class="m-price">${d.price || ''}</div>
      <div class="m-cart-ctrl" id="mCartCtrl">
        ${qty > 0
          ? `<button class="btn-cart-adj" onclick="adjustCart('${d.id}',-1)">−</button>
             <span class="cart-qty-badge">${qty}</span>
             <button class="btn-cart-adj" onclick="adjustCart('${d.id}',1)">+</button>`
          : `<button class="btn-p" onclick="adjustCart('${d.id}',1)">Add to Order</button>`
        }
      </div>
    </div>`;

  document.getElementById('mbg').classList.add('on');
  document.getElementById('dishModal').classList.add('on');
  document.body.style.overflow = 'hidden';
}

window.closeModal = function () {
  document.getElementById('mbg').classList.remove('on');
  document.getElementById('dishModal').classList.remove('on');
  document.body.style.overflow = '';
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ════════════════════════════════
   CART
   ════════════════════════════════ */
window.adjustCart = function(id, delta) {
  const d = allDishes.find(x => String(x.id) === String(id));
  if (!d) return;
  cart[id] = Math.max(0, (cart[id] || 0) + delta);
  if (cart[id] === 0) delete cart[id];
  saveCartToStorage();
  renderCart();
  renderOrderPicker();
  // Refresh modal cart controls if open
  const ctrl = document.getElementById('mCartCtrl');
  if (ctrl) {
    const qty = cart[id] || 0;
    ctrl.innerHTML = qty > 0
      ? `<button class="btn-cart-adj" onclick="adjustCart('${id}',-1)">−</button>
         <span class="cart-qty-badge">${qty}</span>
         <button class="btn-cart-adj" onclick="adjustCart('${id}',1)">+</button>`
      : `<button class="btn-p" onclick="adjustCart('${id}',1)">Add to Order</button>`;
  }
  if (delta > 0) toast(`${d.name} added to your order`);
};

function renderCart() {
  const items = Object.entries(cart);
  const countEl = document.getElementById('cartCount');
  const emptyEl = document.getElementById('cartEmpty');
  const itemsEl = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const totalAmtEl = document.getElementById('cartTotalAmt');

  const totalQty = items.reduce((s, [, q]) => s + q, 0);
  countEl.textContent = totalQty + ' item' + (totalQty !== 1 ? 's' : '');

  if (!items.length) {
    emptyEl.style.display = 'block';
    itemsEl.innerHTML = '';
    totalEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';

  let grandTotal = 0;
  itemsEl.innerHTML = items.map(([id, qty]) => {
    const d = allDishes.find(x => String(x.id) === String(id));
    if (!d) return '';
    const priceNum = parseFloat((d.price || '0').replace(/[^\d.]/g, '')) || 0;
    const lineTotal = priceNum * qty;
    grandTotal += lineTotal;
    return `<div class="cart-item">
      <span class="ci-emoji">${d.emoji || '🥗'}</span>
      <div class="ci-info">
        <div class="ci-name">${d.name}</div>
        <div class="ci-price">${d.price} × ${qty}</div>
      </div>
      <div class="ci-ctrl">
        <button class="btn-ci-adj" onclick="adjustCart('${id}',-1)">−</button>
        <span>${qty}</span>
        <button class="btn-ci-adj" onclick="adjustCart('${id}',1)">+</button>
      </div>
    </div>`;
  }).join('');

  totalEl.style.display = 'flex';
  totalAmtEl.textContent = '₱' + grandTotal.toLocaleString('en-PH', {minimumFractionDigits: 0});
}

function renderOrderPicker() {
  const list = document.getElementById('opList');
  if (!list) return;
  const available = allDishes.filter(d => d.available !== false);
  if (!available.length) {
    list.innerHTML = '<div class="op-loading">Menu loading…</div>';
    return;
  }
  // Group by category
  const grouped = {};
  available.forEach(d => {
    const cat = CATS[d.category] || d.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });
  list.innerHTML = Object.entries(grouped).map(([cat, dishes]) => `
    <div class="op-cat-label">${cat}</div>
    ${dishes.map(d => {
      const qty = cart[d.id] || 0;
      return `<div class="op-item" id="opItem-${d.id}">
        <span class="op-emoji">${d.emoji || '🥗'}</span>
        <div class="op-info">
          <div class="op-name">${d.name}</div>
          <div class="op-price">${d.price || ''}</div>
        </div>
        <div class="op-ctrl">
          ${qty > 0
            ? `<button class="btn-op-adj" onclick="adjustCart('${d.id}',-1)">−</button>
               <span class="op-qty">${qty}</span>
               <button class="btn-op-adj" onclick="adjustCart('${d.id}',1)">+</button>`
            : `<button class="btn-op-add" onclick="adjustCart('${d.id}',1)">+ Add</button>`
          }
        </div>
      </div>`;
    }).join('')}
  `).join('');
}

/* ════════════════════════════════
   ORDER TYPE TOGGLE
   ════════════════════════════════ */
window.setOrderType = function(type) {
  document.getElementById('typePickup').classList.toggle('on', type === 'pickup');
  document.getElementById('typeDelivery').classList.toggle('on', type === 'delivery');
  document.getElementById('deliveryFields').style.display = type === 'delivery' ? 'block' : 'none';
  document.getElementById('o-address').required = type === 'delivery';
};

/* ════════════════════════════════
   ORDER FORM SUBMIT
   ════════════════════════════════ */
async function submitOrder(e) {
  e.preventDefault();

  // Honeypot: real users never fill/see this field. If it's filled, quietly
  // pretend success without touching the database.
  const hp = document.getElementById('o-hp');
  if (hp && hp.value.trim() !== '') {
    const btn = document.getElementById('orderSubmitBtn');
    btn.textContent = '✓ Order Placed!';
    setTimeout(() => { btn.textContent = 'Place My Order'; }, 4000);
    e.target.reset();
    return;
  }

  if (!Object.keys(cart).length) {
    toast('Please add at least one item to your order!', 'error');
    return;
  }

  const isDelivery = document.getElementById('typeDelivery').classList.contains('on');
  const addressVal = document.getElementById('o-address').value.trim();
  if (isDelivery && !addressVal) {
    toast('Please enter a delivery address.', 'error');
    document.getElementById('o-address').focus();
    return;
  }
  if (!document.getElementById('o-date').value || !document.getElementById('o-time').value) {
    toast('Please choose a preferred date and time.', 'error');
    return;
  }

  const orderItems = Object.entries(cart).map(([id, qty]) => {
    const d = allDishes.find(x => String(x.id) === String(id));
    return { id, name: d?.name || id, qty, price: d?.price || '' };
  });
  const payload = {
    name: document.getElementById('o-name').value,
    email: document.getElementById('o-email').value,
    phone: document.getElementById('o-phone').value,
    order_type: isDelivery ? 'delivery' : 'pickup',
    address: isDelivery ? addressVal : null,
    preferred_date: document.getElementById('o-date').value || null,
    preferred_time: document.getElementById('o-time').value || null,
    notes: document.getElementById('o-notes').value,
    items: orderItems,
    status: 'pending'
  };
  const btn = document.getElementById('orderSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Placing order…';
  const { data, error } = await sb.from('orders').insert(payload).select('id').single();
  if (!error) {
    btn.textContent = '✓ Order Placed!';
    btn.style.background = 'var(--green-mid)';
    toast('Order received! We\'ll confirm shortly.');
    const refEl = document.getElementById('orderRef');
    if (data?.id) {
      refEl.textContent = `Your Order ID is #${data.id} — save it to track your order below, using ${payload.email}.`;
      refEl.style.display = 'block';
      // Pre-fill the tracking form for convenience
      const tId = document.getElementById('t-id'), tEmail = document.getElementById('t-email');
      if (tId) tId.value = data.id;
      if (tEmail) tEmail.value = payload.email;
    }
    cart = {};
    saveCartToStorage();
    renderCart();
    renderOrderPicker();
    e.target.reset();
    document.getElementById('deliveryFields').style.display = 'none';
    document.getElementById('typePickup').classList.add('on');
    document.getElementById('typeDelivery').classList.remove('on');
    document.getElementById('o-address').required = false;
    setTimeout(() => { btn.textContent = 'Place My Order'; btn.style.background = ''; btn.disabled = false; }, 4000);
  } else {
    console.error('Order insert error:', error.code, error.message, error.details, error.hint);
    const msg = error.code === '42501'
      ? 'Permission denied. Please run the RLS policy fix in Supabase (see README).'
      : `Could not place order: ${error.message}`;
    toast(msg, 'error');
    btn.disabled = false;
    btn.textContent = 'Place My Order';
  }
}
document.getElementById('orderForm').addEventListener('submit', submitOrder);

/* ════════════════════════════════
   TRACK ORDER
   ════════════════════════════════ */
async function trackOrder(e) {
  e.preventDefault();
  const id = document.getElementById('t-id').value.trim();
  const email = document.getElementById('t-email').value.trim();
  const resultEl = document.getElementById('trackResult');
  const btn = document.getElementById('trackBtn');
  if (!id || !email) return;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  resultEl.innerHTML = '';

  // Uses a security-definer RPC (get_order_status) so the anon key can look up
  // a single order by id+email without being able to read the whole orders table.
  const { data, error } = await sb.rpc('get_order_status', { p_id: id, p_email: email });
  btn.disabled = false;
  btn.textContent = 'Check Status';

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    resultEl.innerHTML = `<div class="track-notfound">We couldn't find an order with that ID and email. Double-check both and try again.</div>`;
    return;
  }
  const items = Array.isArray(row.items) ? row.items : [];
  const itemsHTML = items.map(i => `<span class="dchip">${i.name} ×${i.qty}</span>`).join('');
  resultEl.innerHTML = `
    <div class="track-card">
      <div class="track-card-top">
        <span>Order #${row.id}</span>
        <span class="res-status rs-${row.status}">${(row.status || 'pending').replace('-', ' ')}</span>
      </div>
      <div class="track-card-items">${itemsHTML || '—'}</div>
      <div class="track-card-meta">${row.order_type === 'delivery' ? '🚀 Delivery' : '🏪 Pickup'} · ${[row.preferred_date, row.preferred_time].filter(Boolean).join(' ') || 'No time set'}</div>
    </div>`;
}
document.getElementById('trackForm').addEventListener('submit', trackOrder);

/* ════════════════════════════════
   SETTINGS
   ════════════════════════════════ */
async function loadSettings() {
  const { data, error } = await sb.from('settings').select('*');
  if (error || !data) return;
  siteSettings = Object.fromEntries(data.map(r => [r.key, r.value]));
  const s = siteSettings;
  if (s.hero_sub) document.getElementById('hero-sub-text').textContent = s.hero_sub;
  if (s.footer_tag) document.getElementById('footer-tag-text').textContent = s.footer_tag;
  if (s.hours_weekday) document.getElementById('f-hours-wd').textContent = 'Mon–Fri: ' + s.hours_weekday;
  if (s.hours_saturday) document.getElementById('f-hours-sat').textContent = 'Sat: ' + s.hours_saturday;
  if (s.hours_sunday) document.getElementById('f-hours-sun').textContent = 'Sun: ' + s.hours_sunday;
  if (s.address) document.getElementById('f-address').textContent = s.address;
  if (s.email) { const el = document.getElementById('f-email'); el.textContent = s.email; el.href = 'mailto:' + s.email; }
  if (s.phone) { const el = document.getElementById('f-phone'); el.textContent = s.phone; el.href = 'tel:' + s.phone; }
}

/* ════════════════════════════════
   ANIMATIONS & UI
   ════════════════════════════════ */
const cur = document.getElementById('cur');
document.addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; });
document.addEventListener('mouseover', e => {
  if (e.target.matches('a,button,input,select,.dcard,.ctab')) cur.classList.add('big');
  else cur.classList.remove('big');
});

window.addEventListener('scroll', () => document.getElementById('nav').classList.toggle('sc', scrollY > 60));

const leavesEl = document.getElementById('leaves');
['🥗','🌿','🍃','🌱'].forEach(e => {
  for (let i = 0; i < 3; i++) {
    const l = document.createElement('div');
    l.className = 'leaf';
    l.style.cssText = `font-size:${14+Math.random()*20}px;left:${Math.random()*100}%;bottom:-50px;--dx:${(Math.random()-.5)*180}px;--dy:${-(320+Math.random()*240)}px;--dr:${Math.random()*640-320}deg;animation-duration:${9+Math.random()*10}s;animation-delay:${Math.random()*12}s;`;
    l.textContent = e; leavesEl.appendChild(l);
  }
});

function buildBowl() {
  const sc = document.getElementById('bowlScene');
  const ings = ['🥗','🥑','🍋','🌿','🌯','🍣','🫛','🥕','🥒'];
  sc.innerHTML = `<div class="bs-ring r1"></div><div class="bs-ring r2"></div><div class="bs-ring r3"></div>
    ${ings.slice(0,4).map((e,i)=>{const a=(90*i)+'deg',s=(16+i*2)+'s';return`<div class="bs-sat" style="animation:ringSpin ${s} linear infinite;transform:rotate(${a})"><div class="bs-sat-el" style="left:-20px;top:calc(-95px - 20px);animation:ringSpin ${s} linear infinite reverse">${e}</div></div>`;}).join('')}
    ${ings.slice(4).map((e,i)=>{const a=(51*i)+'deg',s=(25+i*3)+'s';return`<div class="bs-sat" style="animation:ringSpin ${s} linear infinite reverse;transform:rotate(${a})"><div class="bs-sat-el" style="left:-18px;top:calc(-127px - 18px);width:36px;height:36px;font-size:1.1rem;animation:ringSpin ${s} linear infinite">${e}</div></div>`;}).join('')}
    <div class="bs-center">🥗</div>`;
}

const ro = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('v'); ro.unobserve(e.target); } });
}, { threshold: .1 });
function observeReveal() {
  document.querySelectorAll('.rev:not(.observed)').forEach(el => { el.classList.add('observed'); ro.observe(el); });
}

const co = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target.querySelector('[data-t]');
    if (!el) return;
    const t = parseInt(el.dataset.t), suf = el.innerHTML.replace(/[0-9]/g, '');
    let c = 0;
    const iv = setInterval(() => {
      c = Math.min(c + Math.ceil(t/35), t);
      el.innerHTML = `<em>${c}</em>${suf.replace(/<em>|<\/em>/g,'')}`;
      if (c >= t) clearInterval(iv);
    }, 40);
    co.unobserve(entry.target);
  });
}, { threshold: .5 });
document.querySelectorAll('.stat-item').forEach(el => co.observe(el));

/* ════════════════════════════════
   INIT
   ════════════════════════════════ */
function dismissLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  loader.classList.add('out');
  setTimeout(() => loader.remove(), 900);
}

window.addEventListener('load', async () => {
  const loaderTimeout = setTimeout(dismissLoader, 4000);
  try { await Promise.all([loadDishes(), loadSettings()]); }
  catch (e) { console.warn('Init error:', e); }
  buildBowl();
  observeReveal();
  clearTimeout(loaderTimeout);
  setTimeout(dismissLoader, 800);
});
