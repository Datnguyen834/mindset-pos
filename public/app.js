const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let state = {
  user: null,
  menu: [],
  categories: [],
  toppings: [],
  cart: [],
  category: 'Tất cả',
  qr: '',
  page: 'pos',
  paymentMethod: 'cash'
};

const money = (n) => new Intl.NumberFormat('vi-VN').format(Number(n) || 0) + 'đ';
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

// Ngày hiện tại theo đúng múi giờ Việt Nam (UTC+7), độc lập với múi giờ máy/browser.
function localDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

let pendingDeleteAction = null;

function confirmDelete({ title = 'Xác nhận xóa?', message = 'Bạn có chắc muốn xóa', item = 'mục này?', onConfirm }) {
  pendingDeleteAction = onConfirm;
  $('#confirmDeleteTitle').textContent = title;
  $('#confirmDeleteMessage').innerHTML = `${esc(message)} <strong>${esc(item)}</strong>`;
  $('#confirmDeleteButton').disabled = false;
  $('#confirmDeleteButton').textContent = title.toLowerCase().includes('khóa') ? 'Khóa' : 'Xóa';
  $('#confirmModal').classList.remove('hidden');
  $('#confirmModal').setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeConfirmDelete() {
  pendingDeleteAction = null;
  const modal = $('#confirmModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('modal-open');
}

async function runConfirmDelete() {
  if (!pendingDeleteAction) return;
  const action = pendingDeleteAction;
  $('#confirmDeleteButton').disabled = true;
  try {
    await action();
    closeConfirmDelete();
  } catch (e) {
    $('#confirmDeleteButton').disabled = false;
    toast(e.message || 'Có lỗi xảy ra', true);
  }
}

async function api(url, opt = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...opt });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.message || 'Có lỗi xảy ra');
  return d;
}

function fmtDate(x) {
  return new Date(x).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function nav() {
  const admin = state.user.role === 'admin';
  const items = admin
    ? [['pos','☕','Menu'],['orders','▣','Doanh thu'],['users','♙','Quản lý nhân viên'],['settings','⚙','Cài đặt']]
    : [['pos','☕','Menu']];
  $('#nav').innerHTML = items.map(([p, icon, label]) =>
    `<button class="nav-item ${state.page === p ? 'active' : ''}" onclick="go('${p}')"><span class="nav-icon">${icon}</span><span>${label}</span></button>`
  ).join('');
}

function go(p) {
  state.page = p;
  nav();
  renderPage();
}

async function boot() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    $('#userName').textContent = state.user.fullName || state.user.username || '-';
    $('#roleText').textContent = state.user.role === 'admin' ? 'Admin' : 'Nhân viên';
    nav();
    await loadBase();
    renderPage();
  } catch {}
}

async function loadBase() {
  state.menu = await api('/api/menu');
  state.categories = await api('/api/categories');
  state.toppings = await api('/api/toppings');
  const qr = await api('/api/settings/qr');
  state.qr = qr.image || '';
}

function renderPage() {
  $('#page').className = state.page === 'pos' ? 'pos-page' : '';
  if (state.page === 'pos') renderPOS();
  if (state.page === 'orders') renderOrders();
  if (state.page === 'users') renderUsers();
  if (state.page === 'settings') renderSettings();
}

function renderPOS() {
  const cats = ['Tất cả', ...new Set(state.menu.map(x => x.category))];
  $('#page').innerHTML = `
    <div class="content pos-content">
      <div class="page-title compact-title">
        <div><h1>Menu</h1></div>
      </div>
      <div class="pos-layout">
        <section class="menu-panel">
          <div class="categories">
            ${cats.map(c => `<button class="chip ${state.category === c ? 'active' : ''}" onclick="setCat('${esc(c)}')">${esc(c)}</button>`).join('')}
            <input class="search" id="menuSearch" placeholder="⌕ Tìm món..." oninput="filterMenu()">
          </div>
          <div class="menu-grid" id="menuGrid"></div>
        </section>
        <aside class="cart">
          <div class="cart-head"><div><h2>Đơn hàng</h2><small id="cartCount">0 món</small></div><button class="btn small" onclick="clearCart()">Xóa</button></div>
          <div id="cartItems" class="cart-items"></div>
          <div class="cart-total">
            <div class="total-line"><span>Tạm tính</span><b id="subtotal">0đ</b></div>
            <div class="payment-choice">
              <div class="payment-label">Phương thức thanh toán</div>
              <div class="payment-options">
                <button class="payment-option active" id="payCash" onclick="selectPayment('cash')">💵 Tiền mặt</button>
                <button class="payment-option" id="payTransfer" onclick="selectPayment('transfer')">▣ Chuyển khoản</button>
              </div>
            </div>
            <div class="total-line big"><span>Tổng tiền</span><span id="cartTotal">0đ</span></div>
            <button class="primary full payment-main" onclick="checkout()">Thanh toán</button>
          </div>
        </aside>
      </div>
    </div>`;
  drawMenu();
  drawCart();
  syncPaymentUI();
}

function setCat(c) { state.category = c; renderPOS(); }
function filterMenu() { drawMenu(); }

function drawMenu() {
  const search = ($('#menuSearch')?.value || '').toLowerCase();
  const arr = state.menu.filter(m =>
    (state.category === 'Tất cả' || m.category === state.category) &&
    m.name.toLowerCase().includes(search)
  );
  $('#menuGrid').innerHTML = arr.map(m => `
    <article class="menu-card" onclick="openProduct(${m.id})">
      <img src="${m.image || '/assets/logo.png'}" alt="${esc(m.name)}">
      <div class="mc-body"><b>${esc(m.name)}</b><div class="price">${money(m.price)}</div></div>
    </article>`).join('') || '<div class="empty">Không tìm thấy món</div>';
}

function productOptionsHtml(itemIndex = 'new', existing = {}) {
  const sugar = Number(existing.sugarPercent ?? 100);
  const ice = Number(existing.icePercent ?? 100);
  return `
    <div class="custom-grid">
      <label>% Đường
        <select id="sugarPercent">
          ${[0,30,50,70,100].map(v => `<option value="${v}" ${v === sugar ? 'selected' : ''}>${v}%</option>`).join('')}
        </select>
      </label>
      <label>% Đá
        <select id="icePercent">
          ${[0,30,50,70,100].map(v => `<option value="${v}" ${v === ice ? 'selected' : ''}>${v}%</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="topping-title">Topping</div>
    <div class="topping-list">
      ${state.toppings.map(t => {
        const q = (existing.toppings || []).find(z => z.id === t.id)?.quantity || 0;
        return `<div class="topping">
          <div><strong>${esc(t.name)}</strong><br><small>${money(t.price)}</small></div>
          <div class="qty"><button type="button" class="top-adjust-btn" data-top-index="${esc(String(itemIndex))}" data-top-id="${Number(t.id)}" data-top-delta="-1">−</button><b id="top-q-${String(itemIndex)}-${t.id}">${q}</b><button type="button" class="top-adjust-btn" data-top-index="${esc(String(itemIndex))}" data-top-id="${Number(t.id)}" data-top-delta="1">+</button></div>
        </div>`;
      }).join('') || '<div class="empty">Chưa có topping</div>'}
    </div>`;
}

function isBakeryProduct(m) {
  // Cart item cũ có thể không lưu category, nên tra ngược từ menuItemId.
  const category = m?.category
    ?? (m?.menuItemId != null ? state.menu.find(p => Number(p.id) === Number(m.menuItemId))?.category : '');
  return String(category || '').trim().toLowerCase() === 'bánh ngọt';
}

function openProduct(id) {
  const m = state.menu.find(x => x.id === id);
  if (!m) return;

  // Bánh ngọt không có đường/đá/topping: bấm vào là thêm thẳng vào đơn.
  if (isBakeryProduct(m)) {
    state.cart.push({
      key: crypto.randomUUID(),
      menuItemId: m.id,
      name: m.name,
      price: Number(m.price),
      image: m.image,
      category: m.category,
      quantity: 1,
      toppings: [],
      sugarPercent: 100,
      icePercent: 100
    });
    drawCart();
    toast('Đã thêm bánh vào đơn');
    return;
  }

  const temp = { toppings: [], sugarPercent: 100, icePercent: 100 };
  window.__productDraft = temp;
  openModal(`
    <div class="product-modal-head"><img src="${m.image || '/assets/logo.png'}"><div><div class="eyebrow">${esc(m.category)}</div><h3>${esc(m.name)}</h3><strong class="modal-price">${money(m.price)}</strong></div></div>
    ${productOptionsHtml('new', temp)}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick="addConfiguredProduct(${m.id})">Thêm vào đơn</button></div>`);
}

function addConfiguredProduct(id) {
  const m = state.menu.find(x => x.id === id);
  const d = window.__productDraft || {};
  if (!m) return;
  state.cart.push({
    key: crypto.randomUUID(), menuItemId: m.id, name: m.name, price: Number(m.price), image: m.image,
    category: m.category,
    quantity: 1, toppings: d.toppings || [], sugarPercent: Number($('#sugarPercent').value), icePercent: Number($('#icePercent').value)
  });
  closeModal();
  drawCart();
  toast('Đã thêm món vào đơn');
}

function cartSubtotal() {
  return state.cart.reduce((s, x) => s + (x.price + x.toppings.reduce((a, t) => a + t.price * t.quantity, 0)) * x.quantity, 0);
}

function toppingText(x) {
  const tops = x.toppings.length ? x.toppings.map(t => `${esc(t.name)}${t.quantity > 1 ? ` x${t.quantity}` : ''}`).join(', ') : 'Không topping';
  return `${tops} · Đường ${x.sugarPercent}% · Đá ${x.icePercent}%`;
}

function drawCart() {
  const el = $('#cartItems');
  if (!el) return;
  if (!state.cart.length) {
    el.innerHTML = '<div class="empty">Chưa có món<br>Chạm vào món để thêm vào đơn</div>';
  } else {
    el.innerHTML = state.cart.map((x, i) => {
      const bakery = isBakeryProduct(x);
      const customText = bakery ? 'Bánh ngọt · Không topping' : toppingText(x);
      const customizeButton = bakery
        ? ''
        : `<button class="btn small" onclick="editCartItem(${i})">Tùy chỉnh</button>`;

      return `
      <div class="cart-row">
        <img src="${x.image || '/assets/logo.png'}" alt="">
        <div class="cart-main">
          <strong>${esc(x.name)}</strong>
          <div class="cart-custom"><small>${customText}</small></div>
          <div class="qty">
            <button onclick="changeQty(${i},-1)">−</button><span>${x.quantity}</span><button onclick="changeQty(${i},1)">+</button>
            ${customizeButton}
          </div>
        </div>
        <div class="cart-price"><b>${money((x.price + x.toppings.reduce((a,t)=>a+t.price*t.quantity,0))*x.quantity)}</b><button class="remove-btn" onclick="removeCart(${i})">×</button></div>
      </div>`;
    }).join('');
  }
  $('#subtotal').textContent = money(cartSubtotal());
  $('#cartTotal').textContent = money(cartSubtotal());
  $('#cartCount').textContent = `${state.cart.reduce((s, x) => s + x.quantity, 0)} món`;
}

function changeQty(i, d) { state.cart[i].quantity = Math.max(1, state.cart[i].quantity + d); drawCart(); }
function removeCart(i) { state.cart.splice(i, 1); drawCart(); }
function clearCart() { state.cart = []; drawCart(); }

function editCartItem(i) {
  const x = state.cart[i];
  if (!x) return;
  if (isBakeryProduct(x)) return;
  window.__editIndex = i;
  window.__productDraft = { sugarPercent: x.sugarPercent, icePercent: x.icePercent, toppings: x.toppings.map(t => ({...t})) };
  openModal(`
    <div class="product-modal-head"><img src="${x.image || '/assets/logo.png'}"><div><div class="eyebrow">Tùy chỉnh món</div><h3>${esc(x.name)}</h3><strong class="modal-price">${money(x.price)}</strong></div></div>
    ${productOptionsHtml(i, window.__productDraft)}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick="saveCartItem(${i})">Lưu thay đổi</button></div>`);
}

function adjustTopModal(index, id, d) {
  const draf = window.__productDraft;
  const numericId = Number(id);
  const delta = Number(d);
  const t = state.toppings.find(z => Number(z.id) === numericId);
  if (!draf || !t || !Number.isFinite(delta)) return;

  let z = draf.toppings.find(z => Number(z.id) === numericId);
  if (!z && delta > 0) {
    z = { id: numericId, name: t.name, price: Number(t.price), quantity: 0 };
    draf.toppings.push(z);
  }
  if (z) {
    z.quantity = Math.max(0, Number(z.quantity || 0) + delta);
    if (z.quantity === 0) draf.toppings = draf.toppings.filter(a => Number(a.id) !== numericId);
  }

  const q = draf.toppings.find(z => Number(z.id) === numericId)?.quantity || 0;
  const node = document.getElementById(`top-q-${String(index)}-${numericId}`);
  if (node) node.textContent = q;
}

function saveCartItem(i) {
  const x = state.cart[i];
  const d = window.__productDraft;
  if (!x || !d) return;
  x.sugarPercent = Number($('#sugarPercent').value);
  x.icePercent = Number($('#icePercent').value);
  x.toppings = d.toppings.map(t => ({...t}));
  closeModal();
  drawCart();
  toast('Đã cập nhật món');
}

function selectPayment(method) {
  state.paymentMethod = method;
  syncPaymentUI();
}

function syncPaymentUI() {
  const cash = $('#payCash');
  const transfer = $('#payTransfer');
  if (!cash || !transfer) return;
  cash.classList.toggle('active', state.paymentMethod === 'cash');
  transfer.classList.toggle('active', state.paymentMethod === 'transfer');
}

async function checkout() {
  if (!state.cart.length) return toast('Hãy chọn ít nhất một món', true);
  if (state.paymentMethod === 'transfer') {
    if (!state.qr) return toast('Admin chưa upload QR chuyển khoản', true);
    openModal(`<h3>Quét QR chuyển khoản</h3><p class="muted">Khách quét mã, kiểm tra giao dịch rồi bấm xác nhận.</p><img class="checkout-qr" src="${state.qr}" alt="QR chuyển khoản"><div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick="completePayment('transfer')">Thanh toán thành công</button></div>`);
  } else {
    openModal(`<div class="success"><div class="check">💵</div><h3>Xác nhận thanh toán tiền mặt</h3><p>Tổng tiền: <b class="modal-total">${money(cartSubtotal())}</b></p></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick="completePayment('cash')">Xác nhận thanh toán</button></div>`);
  }
}

async function completePayment(method) {
  try {
    const d = await api('/api/orders', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        items: state.cart.map(x => ({
          menuItemId:x.menuItemId, quantity:x.quantity,
          sugarPercent:x.sugarPercent, icePercent:x.icePercent,
          toppings:x.toppings.map(t => ({id:t.id,quantity:t.quantity}))
        })),
        paymentMethod:method
      })
    });
    state.cart = [];
    closeModal();
    renderPOS();
    openModal(`<div class="success payment-success"><div class="check">✓</div><h3>Thanh toán thành công</h3><p>Đơn <b>#${d.orderId}</b> · Tổng tiền <b class="modal-total">${money(d.total)}</b></p><p class="muted">Bạn có muốn in hóa đơn không?</p></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Bỏ qua</button><button class="btn primary" onclick="printOrder(${d.orderId})">In bill</button></div>`);
    toast(`Đã thanh toán #${d.orderId} — ${money(d.total)}`);
  } catch (e) { toast(e.message, true); }
}

async function renderOrders() {
  $('#page').innerHTML = `<div class="content revenue-page">
    <div class="page-title">
      <div><h1>Doanh thu</h1><p>Xem doanh thu theo ngày hoặc tháng, theo từng nhân viên và toàn bộ cửa hàng.</p></div>
    </div>
    <div class="revenue-filter-bar">
      <div class="revenue-mode-tabs">
        <button class="report-tab active" id="revDayTab" onclick="setRevenueMode('day')">Theo ngày</button>
        <button class="report-tab" id="revMonthTab" onclick="setRevenueMode('month')">Theo tháng</button>
      </div>
      <div id="revenueDateControls"></div>
    </div>
    <div id="staffOrdersArea" class="revenue-results"><div class="empty">Đang tải doanh thu...</div></div>
  </div>`;
  setRevenueMode('day');
}

function setRevenueMode(mode) {
  window.__revenueMode = mode;
  $('#revDayTab')?.classList.toggle('active', mode === 'day');
  $('#revMonthTab')?.classList.toggle('active', mode === 'month');
  const today = localDateString();
  const month = today.slice(0,7);
  $('#revenueDateControls').innerHTML = mode === 'day'
    ? `<div class="revenue-selector"><label>Chọn ngày<input id="revenueDate" type="date" value="${today}"></label><button class="btn primary" onclick="loadStaffRevenue()">Xem doanh thu</button></div>`
    : `<div class="revenue-selector"><label>Chọn tháng<input id="revenueMonth" type="month" value="${month}"></label><button class="btn primary" onclick="loadStaffRevenue()">Xem doanh thu</button></div>`;
  loadStaffRevenue();
}

function revenueRange() {
  if (window.__revenueMode === 'month') {
    const value = $('#revenueMonth')?.value;
    if (!value) throw new Error('Hãy chọn tháng');
    const [year, m] = value.split('-').map(Number);
    const last = new Date(year, m, 0).getDate();
    return {
      from: `${year}-${String(m).padStart(2,'0')}-01`,
      to: `${year}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`,
      label: `Tháng ${String(m).padStart(2,'0')}/${year}`
    };
  }
  const date = $('#revenueDate')?.value;
  if (!date) throw new Error('Hãy chọn ngày');
  return { from: date, to: date, label: `Ngày ${date.split('-').reverse().join('/')}` };
}

async function loadStaffRevenue() {
  try {
    const range = revenueRange();
    $('#staffOrdersArea').innerHTML = '<div class="empty">Đang tải doanh thu...</div>';
    const d = await api(`/api/admin/orders/staff?from=${range.from}&to=${range.to}`);
    const staff = d.staff || [];
    const total = d.total || {orders:0,revenue:0,cash:0,transfer:0};
    $('#staffOrdersArea').innerHTML = `
      <div class="revenue-heading"><h2>${range.label}</h2><span>${total.orders} đơn hàng</span></div>
      <div class="staff-revenue-scroll">
        <div class="staff-revenue-grid">
          ${staff.map(u => `
            <button class="staff-revenue-card" onclick="showStaffOrders(${u.id}, '${esc(u.fullName).replace(/'/g, "\\'")}')">
              <div class="staff-revenue-top"><div class="staff-order-icon">♙</div><div class="staff-revenue-name"><strong>${esc(u.fullName)}</strong><span>${u.orders} đơn</span></div><span class="staff-order-arrow">›</span></div>
              <div class="staff-revenue-total">${money(u.revenue)}</div>
              <div class="staff-revenue-split"><span><small>💵 Tiền mặt</small><b>${money(u.cash)}</b></span><span><small>▣ Chuyển khoản</small><b>${money(u.transfer)}</b></span></div>
            </button>`).join('') || '<div class="empty">Chưa có nhân viên phát sinh đơn trong khoảng thời gian này</div>'}
        </div>
      </div>
      <button class="revenue-total-card" type="button" onclick="showAllOrders()">
        <div><strong>TỔNG TẤT CẢ NHÂN VIÊN</strong><span>${total.orders} đơn · Bấm để xem toàn bộ đơn hàng</span></div>
        <div class="revenue-total-money">${money(total.revenue)}</div>
        <div class="revenue-total-split"><span>💵 ${money(total.cash)}</span><span>▣ ${money(total.transfer)}</span></div>
      </button>`;
  } catch (e) {
    $('#staffOrdersArea').innerHTML = `<div class="empty error-empty">${esc(e.message || 'Không tải được doanh thu')}</div>`;
  }
}

async function showStaffOrders(staffId, staffName) {
  const range = revenueRange();
  $('#staffOrdersArea').innerHTML = `<div class="page-title compact-title detail-title"><div><h2 style="margin:0">Đơn hàng của ${esc(staffName)}</h2><p>Lọc lại đơn theo ngày, phương thức thanh toán hoặc sản phẩm.</p></div><button class="btn" onclick="loadStaffRevenue()">← Danh sách nhân viên</button></div>
    <div class="order-filter-panel">
      <label>Ngày từ<input id="staffFrom" type="date" value="${range.from}"></label>
      <label>Đến ngày<input id="staffTo" type="date" value="${range.to}"></label>
      <label>Thanh toán<select id="staffPayment"><option value="">Tất cả</option><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option></select></label>
      <label class="product-filter">Sản phẩm<input id="staffProduct" placeholder="Ví dụ: Latte"></label>
      <button class="btn primary" onclick="loadStaffOrderDetail(${staffId}, '${esc(staffName).replace(/'/g, "\\'")}')">Tìm đơn hàng</button>
    </div>
    <div class="panel order-detail-panel"><div id="staffOrderSummary" class="order-detail-summary"></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Mã</th><th>Thời gian</th><th>Sản phẩm</th><th>Thanh toán</th><th>Tổng</th><th></th></tr></thead><tbody id="ordersBody"><tr><td colspan="6">Đang tải...</td></tr></tbody></table></div></div>`;
  await loadStaffOrderDetail(staffId, staffName);
}

async function loadStaffOrderDetail(staffId, staffName) {
  try {
    const from = $('#staffFrom')?.value || '';
    const to = $('#staffTo')?.value || '';
    const payment = $('#staffPayment')?.value || '';
    const product = $('#staffProduct')?.value?.trim() || '';
    const qs = new URLSearchParams({from,to,payment,product});
    const list = await api(`/api/admin/orders/staff/${staffId}?${qs.toString()}`);
    const orders = list.orders || [];
    const s = list.summary || {orders:0,total:0,cash:0,transfer:0};
    $('#staffOrderSummary').innerHTML = `<span><b>${s.orders}</b> đơn</span><span>Tổng <b>${money(s.total)}</b></span><span>💵 <b>${money(s.cash)}</b></span><span>▣ <b>${money(s.transfer)}</b></span>`;
    $('#ordersBody').innerHTML = orders.map(o => `<tr><td>#${o.id}</td><td>${fmtDate(o.created_at)}</td><td><strong>${esc(o.products || '—')}</strong></td><td>${o.payment_method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}</td><td><b>${money(o.total)}</b></td><td><button class="btn small" onclick="printOrder(${o.id})">Xem đơn</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Không tìm thấy đơn phù hợp</td></tr>';
  } catch (e) {
    $('#ordersBody').innerHTML = `<tr><td colspan="6" class="empty error-empty">${esc(e.message || 'Không tải được đơn hàng')}</td></tr>`;
  }
}

async function showAllOrders() {
  const range = revenueRange();
  $('#staffOrdersArea').innerHTML = `<div class="page-title compact-title detail-title"><div><h2 style="margin:0">Tất cả đơn hàng</h2><p>Lọc toàn bộ đơn của tất cả nhân viên.</p></div><button class="btn" onclick="loadStaffRevenue()">← Doanh thu</button></div>
    <div class="order-filter-panel"><label>Ngày từ<input id="staffFrom" type="date" value="${range.from}"></label><label>Đến ngày<input id="staffTo" type="date" value="${range.to}"></label><label>Nhân viên<select id="allStaffFilter"><option value="">Tất cả</option></select></label><label>Thanh toán<select id="staffPayment"><option value="">Tất cả</option><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option></select></label><label class="product-filter">Sản phẩm<input id="staffProduct" placeholder="Tên sản phẩm"></label><button class="btn primary" onclick="loadAllOrders()">Tìm đơn hàng</button></div>
    <div class="panel order-detail-panel"><div id="staffOrderSummary" class="order-detail-summary"></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Mã</th><th>Thời gian</th><th>Nhân viên</th><th>Sản phẩm</th><th>Thanh toán</th><th>Tổng</th><th></th></tr></thead><tbody id="ordersBody"><tr><td colspan="7">Đang tải...</td></tr></tbody></table></div></div>`;
  const list = await api(`/api/admin/orders/staff?from=${range.from}&to=${range.to}`);
  $('#allStaffFilter').innerHTML = '<option value="">Tất cả</option>' + (list.staff || []).map(u => `<option value="${u.id}">${esc(u.fullName)}</option>`).join('');
  await loadAllOrders();
}

async function loadAllOrders() {
  try {
    const from=$('#staffFrom')?.value||'', to=$('#staffTo')?.value||'', payment=$('#staffPayment')?.value||'', product=$('#staffProduct')?.value?.trim()||'', staffId=$('#allStaffFilter')?.value||'';
    const qs=new URLSearchParams({from,to,payment,product,staffId});
    const d=await api(`/api/admin/orders/all?${qs.toString()}`);
    const s=d.summary||{orders:0,total:0,cash:0,transfer:0};
    $('#staffOrderSummary').innerHTML=`<span><b>${s.orders}</b> đơn</span><span>Tổng <b>${money(s.total)}</b></span><span>💵 <b>${money(s.cash)}</b></span><span>▣ <b>${money(s.transfer)}</b></span>`;
    $('#ordersBody').innerHTML=(d.orders||[]).map(o=>`<tr><td>#${o.id}</td><td>${fmtDate(o.created_at)}</td><td>${esc(o.fullName)}</td><td><strong>${esc(o.products||'—')}</strong></td><td>${o.payment_method==='cash'?'Tiền mặt':'Chuyển khoản'}</td><td><b>${money(o.total)}</b></td><td><button class="btn small" onclick="printOrder(${o.id})">Xem đơn</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Không tìm thấy đơn phù hợp</td></tr>';
  } catch(e) { $('#ordersBody').innerHTML=`<tr><td colspan="7" class="empty error-empty">${esc(e.message||'Không tải được đơn hàng')}</td></tr>`; }
}
window.showStaffOrders=showStaffOrders;
window.loadStaffOrderDetail=loadStaffOrderDetail;
window.showAllOrders=showAllOrders;
window.loadAllOrders=loadAllOrders;
window.setRevenueMode=setRevenueMode;
window.loadStaffRevenue=loadStaffRevenue;
async function printOrder(id) {
  const o = await api('/api/orders/' + id);
  openModal(`<div class="invoice"><h1>Mindset</h1><p style="text-align:center">HÓA ĐƠN #${o.id}</p><p>${fmtDate(o.created_at)}<br>Nhân viên: ${esc(o.staff)}</p><table>${o.items.map(x => `<tr><td><strong>${esc(x.item_name)} x${x.quantity}</strong><br><small>Đường ${x.sugar_percent}% · Đá ${x.ice_percent}%<br>${x.toppings.map(t => esc(t.name)).join(', ') || 'Không topping'}</small></td><td class="r">${money(x.line_total)}</td></tr>`).join('')}</table><hr><p class="r"><b>TỔNG: ${money(o.total)}</b></p><p style="text-align:center">Cảm ơn quý khách!</p></div><div class="modal-actions no-print"><button class="btn" onclick="window.print()">In</button><button class="btn" onclick="closeModal()">Đóng</button></div>`);
}

async function renderUsers() {
  const users = await api('/api/admin/users');
  state.userList = users;
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Quản lý nhân viên</h1><p>Tạo tài khoản, đổi mật khẩu và phân quyền.</p></div><button class="btn primary" onclick="userForm()">+ Thêm tài khoản</button></div><div class="table-card"><table class="data-table"><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Quyền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.fullName)}</td><td><b>${u.role === 'admin' ? 'Admin' : 'Nhân viên'}</b></td><td>${u.active ? 'Đang hoạt động' : 'Đã khóa'}</td><td>${u.role === 'admin' ? '<span class="muted">Bảo vệ</span>' : `<button class="btn small" onclick='userForm(${JSON.stringify(u)})'>Sửa</button> <button class="btn small danger" onclick="deleteUser(${u.id})">Xóa</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function userForm(u = {}) {
  openModal(`<h3>${u.id ? 'Sửa tài khoản' : 'Thêm tài khoản'}</h3><div class="form-grid"><label>Tài khoản<input id="fUsername" value="${esc(u.username || '')}" ${u.id ? 'disabled' : ''}></label><label>Họ tên<input id="fFullName" value="${esc(u.fullName || '')}"></label><label>Mật khẩu<input id="fPassword" type="password" placeholder="${u.id ? 'Để trống nếu không đổi' : ''}"></label><label>Quyền<select id="fRole"><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Nhân viên</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick='saveUser(${u.id || 'null'})'>Lưu</button></div>`);
}

async function saveUser(id) {
  try {
    const body = { fullName:$('#fFullName').value, role:$('#fRole').value };
    if ($('#fPassword').value) body.password = $('#fPassword').value;
    if (!id) { body.username = $('#fUsername').value; if (!body.password) throw new Error('Cần nhập mật khẩu'); }
    await api(id ? `/api/admin/users/${id}` : '/api/admin/users', { method:id ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    closeModal(); toast('Đã lưu'); renderUsers();
  } catch (e) { toast(e.message, true); }
}

async function deleteUser(id) {
  const u = state.userList?.find(x => x.id === id);
  if (!u) { toast('Không tìm thấy tài khoản', true); return; }
  confirmDelete({
    title: 'Xóa tài khoản?',
    message: 'Bạn có chắc muốn xóa hẳn tài khoản',
    item: u.username + '?',
    onConfirm: async () => {
      await api('/api/admin/users/' + id, {method:'DELETE'});
      toast('Đã xóa tài khoản');
      await renderUsers();
    }
  });
}

async function renderSettings() {
  const menu = await api('/api/menu');
  const categories = state.categories || [];
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Cài đặt</h1><p>Quản lý menu, danh mục, topping và QR chuyển khoản.</p></div></div><div class="report-grid"><section class="section-card"><div class="category-management"><div class="category-management-title"><h3>Danh mục</h3></div><div class="category-actions"><div class="category-chips">${categories.map(c => `<div class="category-chip"><span>${esc(c.name)}</span><button type="button" onclick='categoryForm(${JSON.stringify(c)})' aria-label="Sửa danh mục">Sửa</button><button type="button" class="danger-text" onclick="deleteCategory(${c.id})" aria-label="Xóa danh mục">Xóa</button></div>`).join('')}<button class="btn category-add-btn" onclick="categoryForm()">+ Thêm danh mục</button></div></div></div><div class="settings-section-head menu-section-head"><h3>Menu món</h3><button class="btn primary" onclick="menuForm()">+ Thêm món</button></div><div class="table-card" style="margin-top:15px"><table class="data-table"><thead><tr><th>Món</th><th>Danh mục</th><th>Giá</th><th></th></tr></thead><tbody>${menu.map(m => `<tr><td><img class="avatar" src="${m.image || '/assets/logo.png'}">${esc(m.name)}</td><td>${esc(m.category)}</td><td>${money(m.price)}</td><td><button class="btn small" onclick='menuForm(${JSON.stringify(m)})'>Sửa</button> <button class="btn small danger" onclick="deleteMenu(${m.id})">Xóa</button></td></tr>`).join('')}</tbody></table></div></section><section class="section-card"><h3>QR chuyển khoản</h3><p class="muted">Ảnh này sẽ hiện cho nhân viên khi chọn chuyển khoản.</p>${state.qr ? `<img class="qr-preview" src="${state.qr}">` : '<div class="empty">Chưa có QR</div>'}<form id="qrForm" style="margin-top:14px"><input type="file" id="qrFile" accept="image/*"><button class="btn primary" style="margin-top:10px" type="submit">Upload QR</button></form><hr><div class="settings-section-head"><h3>Topping</h3><button class="btn" onclick="toppingForm()">+ Thêm topping</button></div><div>${state.toppings.map(t => `<div class="topping"><span>${esc(t.name)} · ${money(t.price)}</span><button class="btn small danger" onclick="deleteTop(${t.id})">Xóa</button></div>`).join('')}</div></section></div></div>`;
  $('#qrForm').onsubmit = uploadQR;
}

function categoryForm(c = {}, returnToMenu = false) {
  openModal(`<h3>${c.id ? 'Sửa danh mục' : 'Thêm danh mục'}</h3><form id="categoryForm"><label>Tên danh mục<input id="catName" value="${esc(c.name || '')}" maxlength="40" placeholder="Ví dụ: Sinh tố" required></label><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`);
  $('#categoryForm').onsubmit = async e => {
    e.preventDefault();
    const name = $('#catName').value.trim();
    if (!name) return;
    try {
      await api(c.id ? `/api/admin/categories/${c.id}` : '/api/admin/categories', {method:c.id ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
      closeModal();
      await loadBase();
      toast(c.id ? 'Đã sửa danh mục' : 'Đã thêm danh mục');
      if (returnToMenu) menuForm({...window.__menuDraft, category:name}); else renderSettings();
    } catch (e) { toast(e.message, true); }
  };
}

async function deleteCategory(id) {
  const c = state.categories?.find(x => x.id === id);
  confirmDelete({
    title: 'Xóa danh mục?',
    message: 'Bạn có chắc muốn xóa danh mục',
    item: c?.name ? c.name + '?' : 'này?',
    onConfirm: async () => {
      await api('/api/admin/categories/' + id, {method:'DELETE'});
      await loadBase();
      await renderSettings();
      toast('Đã xóa danh mục');
    }
  });
}

function menuForm(m = {}) {
  const cats = state.categories || [];
  openModal(`<h3>${m.id ? 'Sửa món' : 'Thêm món'}</h3><form id="menuForm"><div class="form-grid"><label>Tên món<input id="mName" value="${esc(m.name || '')}" required></label><label>Danh mục<select id="mCat">${cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select></label><label>Giá<input id="mPrice" type="number" value="${m.price || 0}" min="0" required></label><label>Ảnh<input id="mImage" type="file" accept="image/*"></label></div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form></div>`);
  if (m.category) $('#mCat').value = m.category;
  $('#menuForm').onsubmit = e => saveMenu(e, m.id);
}

async function saveMenu(e, id) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('name', $('#mName').value); fd.append('category', $('#mCat').value); fd.append('price', $('#mPrice').value);
  if ($('#mImage').files[0]) fd.append('image', $('#mImage').files[0]);
  try { await api(id ? `/api/admin/menu/${id}` : '/api/admin/menu', {method:id ? 'PUT' : 'POST', body:fd}); closeModal(); await loadBase(); toast('Đã lưu món'); renderSettings(); }
  catch (e) { toast(e.message, true); }
}

async function deleteMenu(id) {
  const m = state.menu?.find(x => x.id === id);
  confirmDelete({
    title: 'Xóa sản phẩm?',
    message: 'Bạn có chắc muốn xóa sản phẩm',
    item: m?.name ? m.name + '?' : 'này?',
    onConfirm: async () => {
      await api('/api/admin/menu/' + id, {method:'DELETE'});
      await loadBase();
      await renderSettings();
      toast('Đã xóa sản phẩm');
    }
  });
}
function toppingForm() { openModal(`<h3>Thêm topping</h3><label>Tên topping<input id="tName"></label><label>Giá<input id="tPrice" type="number" value="0"></label><div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick="saveTop()">Lưu</button></div>`); }
async function saveTop() { await api('/api/admin/toppings', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#tName').value,price:$('#tPrice').value})}); closeModal(); await loadBase(); renderSettings(); }
async function deleteTop(id) {
  const t = state.toppings?.find(x => x.id === id);
  confirmDelete({
    title: 'Xóa topping?',
    message: 'Bạn có chắc muốn xóa topping',
    item: t?.name ? t.name + '?' : 'này?',
    onConfirm: async () => {
      await api('/api/admin/toppings/' + id,{method:'DELETE'});
      await loadBase();
      await renderSettings();
      toast('Đã xóa topping');
    }
  });
}
async function uploadQR(e) { e.preventDefault(); const f = $('#qrFile').files[0]; if (!f) return toast('Chọn file QR', true); const fd = new FormData(); fd.append('qr', f); try { await api('/api/admin/qr', {method:'POST',body:fd}); await loadBase(); toast('Đã upload QR'); renderSettings(); } catch(e) { toast(e.message,true); } }

async function renderReports() {
  const today = localDateString();
  const month = today.slice(0,7);
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Doanh thu</h1><p>Chọn cách xem doanh thu.</p></div></div><div class="report-tabs"><button class="report-tab active" id="reportDayTab" onclick="showReportMode('day')">Theo ngày</button><button class="report-tab" id="reportMonthTab" onclick="showReportMode('month')">Theo tháng</button></div><div id="reportControls"></div><div id="reportArea"><div class="empty">Chọn ngày hoặc tháng để xem doanh thu</div></div></div>`;
  showReportMode('day');
}

function showReportMode(mode) {
  $('#reportDayTab')?.classList.toggle('active', mode === 'day');
  $('#reportMonthTab')?.classList.toggle('active', mode === 'month');
  const today = localDateString();
  const month = today.slice(0,7);
  if (mode === 'day') {
    $('#reportControls').innerHTML = `<div class="report-selector"><label>Chọn ngày<input id="reportDate" type="date" value="${today}"></label><button class="btn primary" onclick="loadReportDay()">Xem doanh thu</button></div>`;
    $('#reportArea').innerHTML = '<div class="empty">Chọn ngày rồi bấm “Xem doanh thu”</div>';
  } else {
    $('#reportControls').innerHTML = `<div class="report-selector"><label>Chọn tháng<input id="reportMonth" type="month" value="${month}"></label><button class="btn primary" onclick="loadReportMonth()">Xem doanh thu</button></div>`;
    $('#reportArea').innerHTML = '<div class="empty">Chọn tháng rồi bấm “Xem doanh thu”</div>';
  }
}

async function loadReportDay() {
  const date = $('#reportDate').value;
  if (!date) return toast('Hãy chọn ngày', true);
  await loadReportRange(date, date, `Doanh thu ngày ${date.split('-').reverse().join('/')}`);
}

async function loadReportMonth() {
  const month = $('#reportMonth').value;
  if (!month) return toast('Hãy chọn tháng', true);
  const [year, m] = month.split('-').map(Number);
  const last = new Date(year, m, 0).getDate();
  const from = `${year}-${String(m).padStart(2,'0')}-01`;
  const to = `${year}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
  await loadReportRange(from, to, `Doanh thu tháng ${String(m).padStart(2,'0')}/${year}`);
}

async function loadReportRange(from, to, title) {
  try {
    const d = await api(`/api/admin/reports/summary?from=${from}&to=${to}`);
    const s = d.summary;
    $('#reportArea').innerHTML = `<div class="report-result-title"><h2>${title}</h2><span>${s.orders} đơn hàng</span></div><div class="stats"><div class="stat"><span>Doanh thu</span><strong>${money(s.total)}</strong></div><div class="stat"><span>Số đơn</span><strong>${s.orders}</strong></div><div class="stat"><span>Tiền mặt</span><strong>${money(s.cash)}</strong></div><div class="stat"><span>Chuyển khoản</span><strong>${money(s.transfer)}</strong></div></div><div class="report-grid"><section class="section-card"><h3>Theo nhân viên</h3><table class="data-table"><thead><tr><th>Nhân viên</th><th>Đơn</th><th>Doanh thu</th></tr></thead><tbody>${d.byStaff.map(x => `<tr><td>${esc(x.fullName)}</td><td>${x.orders}</td><td><b>${money(x.revenue)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Chưa có dữ liệu</td></tr>'}</tbody></table></section><section class="section-card"><h3>Theo ngày</h3><table class="data-table"><thead><tr><th>Ngày</th><th>Đơn</th><th>Doanh thu</th></tr></thead><tbody>${d.byDay.map(x => `<tr><td>${x.day}</td><td>${x.orders}</td><td><b>${money(x.revenue)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Chưa có dữ liệu</td></tr>'}</tbody></table></section></div>`;
  } catch (e) { toast(e.message, true); }
}
window.showReportMode = showReportMode;
window.loadReportDay = loadReportDay;
window.loadReportMonth = loadReportMonth;

function openModal(html) {
  const box = $('#modalBox');
  box.innerHTML = html;
  // Dùng event delegation cho nút +/- topping để hoạt động ổn định cả khi mở món mới
  // và khi bấm "Tùy chỉnh" một món đã có trong đơn.
  box.onclick = (e) => {
    const btn = e.target.closest('.top-adjust-btn');
    if (!btn || !box.contains(btn)) return;
    e.preventDefault();
    adjustTopModal(btn.dataset.topIndex, Number(btn.dataset.topId), Number(btn.dataset.topDelta));
  };
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); window.__productDraft = null; window.__editIndex = null; }
window.closeModal = closeModal;

async function enterAppFullscreen() {
  if (document.fullscreenElement) return true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch (e) {
    return false;
  }
}

async function exitAppFullscreen() {
  if (!document.fullscreenElement) return;
  try { await document.exitFullscreen(); } catch {}
}

async function logout() {
  await api('/api/auth/logout',{method:'POST'}).catch(()=>{});
  await exitAppFullscreen();
  location.reload();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  // Gọi ngay trong thao tác click/submit của người dùng để trình duyệt
  // cho phép vào fullscreen. Nếu đăng nhập thất bại, thoát fullscreen lại.
  const fullscreenStarted = await enterAppFullscreen();

  try {
    await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#loginUser').value,password:$('#loginPass').value})});
    await boot();
  } catch(e) {
    if (fullscreenStarted) await exitAppFullscreen();
    toast(e.message,true);
  }
});
$('#togglePass').onclick = () => { const i=$('#loginPass'); i.type=i.type==='password'?'text':'password'; $('#togglePass').textContent=i.type==='password'?'Hiện':'Ẩn'; };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleString('vi-VN',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});} setInterval(tick,1000); tick();

Object.assign(window,{go,logout,setCat,filterMenu,openProduct,addConfiguredProduct,changeQty,removeCart,clearCart,editCartItem,adjustTopModal,saveCartItem,selectPayment,checkout,completePayment,printOrder,userForm,saveUser,deleteUser,menuForm,saveMenu,deleteMenu,categoryForm,deleteCategory,toppingForm,saveTop,deleteTop,uploadQR,loadReport,confirmDelete,closeConfirmDelete,runConfirmDelete});
boot();
