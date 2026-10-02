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
    ? [['pos','☕','Gọi món'],['orders','▣','Đơn hàng'],['reports','▥','Doanh thu'],['users','♙','Quản lý nhân viên'],['settings','⚙','Cài đặt']]
    : [['pos','☕','Gọi món']];
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
    $('#userName').textContent = state.user.fullName;
    $('#roleBadge').textContent = state.user.role === 'admin' ? 'ADMIN' : 'NHÂN VIÊN';
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
  if (state.page === 'reports') renderReports();
  if (state.page === 'users') renderUsers();
  if (state.page === 'settings') renderSettings();
}

function renderPOS() {
  const cats = ['Tất cả', ...new Set(state.menu.map(x => x.category))];
  $('#page').innerHTML = `
    <div class="content pos-content">
      <div class="page-title compact-title">
        <div><h1>Gọi món</h1></div>
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
          <div class="qty"><button onclick="adjustTopModal(${itemIndex},${t.id},-1)">−</button><b id="top-q-${itemIndex}-${t.id}">${q}</b><button onclick="adjustTopModal(${itemIndex},${t.id},1)">+</button></div>
        </div>`;
      }).join('') || '<div class="empty">Chưa có topping</div>'}
    </div>`;
}

function openProduct(id) {
  const m = state.menu.find(x => x.id === id);
  if (!m) return;
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
    el.innerHTML = state.cart.map((x, i) => `
      <div class="cart-row">
        <img src="${x.image || '/assets/logo.png'}" alt="">
        <div class="cart-main">
          <strong>${esc(x.name)}</strong>
          <div class="cart-custom"><small>${toppingText(x)}</small></div>
          <div class="qty">
            <button onclick="changeQty(${i},-1)">−</button><span>${x.quantity}</span><button onclick="changeQty(${i},1)">+</button>
            <button class="btn small" onclick="editCartItem(${i})">Tùy chỉnh</button>
          </div>
        </div>
        <div class="cart-price"><b>${money((x.price + x.toppings.reduce((a,t)=>a+t.price*t.quantity,0))*x.quantity)}</b><button class="remove-btn" onclick="removeCart(${i})">×</button></div>
      </div>`).join('');
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
  window.__editIndex = i;
  window.__productDraft = { sugarPercent: x.sugarPercent, icePercent: x.icePercent, toppings: x.toppings.map(t => ({...t})) };
  openModal(`
    <div class="product-modal-head"><img src="${x.image || '/assets/logo.png'}"><div><div class="eyebrow">Tùy chỉnh món</div><h3>${esc(x.name)}</h3><strong class="modal-price">${money(x.price)}</strong></div></div>
    ${productOptionsHtml(i, window.__productDraft)}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick="saveCartItem(${i})">Lưu thay đổi</button></div>`);
}

function adjustTopModal(index, id, d) {
  const draf = window.__productDraft;
  const t = state.toppings.find(z => z.id === id);
  if (!draf || !t) return;
  let z = draf.toppings.find(z => z.id === id);
  if (!z && d > 0) { z = { id:t.id, name:t.name, price:Number(t.price), quantity:0 }; draf.toppings.push(z); }
  if (z) {
    z.quantity = Math.max(0, z.quantity + d);
    if (z.quantity === 0) draf.toppings = draf.toppings.filter(a => a.id !== id);
  }
  const q = draf.toppings.find(z => z.id === id)?.quantity || 0;
  const node = document.querySelector(`#top-q-${index}-${id}`);
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
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Đơn hàng</h1><p>Chọn nhân viên để xem các đơn hàng nhân viên đó đã bán.</p></div></div><div id="staffOrdersArea"><div class="empty">Đang tải danh sách nhân viên...</div></div></div>`;
  const list = await api('/api/admin/orders/staff').catch(() => ({staff:[]}));
  const staff = list.staff || [];
  $('#staffOrdersArea').innerHTML = staff.length ? `<div class="staff-order-grid">${staff.map(u => `<button class="staff-order-card" onclick="showStaffOrders(${u.id}, '${esc(u.fullName).replace(/'/g, "\\'")}')"><div class="staff-order-icon">♙</div><div class="staff-order-info"><strong>${esc(u.fullName)}</strong><span>${u.orders} đơn · ${money(u.revenue)}</span></div><span class="staff-order-arrow">›</span></button>`).join('')}</div>` : '<div class="empty">Chưa có nhân viên phát sinh đơn hàng</div>';
}

async function showStaffOrders(staffId, staffName) {
  $('#staffOrdersArea').innerHTML = `<div class="page-title compact-title"><div><h2 style="margin:0">Đơn hàng của ${esc(staffName)}</h2><p>Danh sách các đơn hàng nhân viên này đã bán.</p></div><button class="btn" onclick="renderOrders()">← Danh sách nhân viên</button></div><div class="panel"><table class="data-table"><thead><tr><th>Mã</th><th>Thời gian</th><th>Thanh toán</th><th>Tổng</th><th></th></tr></thead><tbody id="ordersBody"><tr><td colspan="5">Đang tải...</td></tr></tbody></table></div>`;
  const list = await api('/api/admin/orders/staff/' + staffId).catch(() => ({orders:[]}));
  $('#ordersBody').innerHTML = (list.orders || []).map(o => `<tr><td>#${o.id}</td><td>${fmtDate(o.created_at)}</td><td>${o.payment_method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}</td><td><b>${money(o.total)}</b></td><td><button class="btn small" onclick="printOrder(${o.id})">In hóa đơn</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nhân viên này chưa có đơn hàng</td></tr>';
}
window.showStaffOrders = showStaffOrders;

async function printOrder(id) {
  const o = await api('/api/orders/' + id);
  openModal(`<div class="invoice"><h1>Mindset</h1><p style="text-align:center">HÓA ĐƠN #${o.id}</p><p>${fmtDate(o.created_at)}<br>Nhân viên: ${esc(o.staff)}</p><table>${o.items.map(x => `<tr><td><strong>${esc(x.item_name)} x${x.quantity}</strong><br><small>Đường ${x.sugar_percent}% · Đá ${x.ice_percent}%<br>${x.toppings.map(t => esc(t.name)).join(', ') || 'Không topping'}</small></td><td class="r">${money(x.line_total)}</td></tr>`).join('')}</table><hr><p class="r"><b>TỔNG: ${money(o.total)}</b></p><p style="text-align:center">Cảm ơn quý khách!</p></div><div class="modal-actions no-print"><button class="btn" onclick="window.print()">In</button><button class="btn" onclick="closeModal()">Đóng</button></div>`);
}

async function renderUsers() {
  const users = await api('/api/admin/users');
  state.userList = users;
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Quản lý nhân viên</h1><p>Tạo tài khoản, đổi mật khẩu và phân quyền.</p></div><button class="btn primary" onclick="userForm()">+ Thêm tài khoản</button></div><div class="table-card"><table class="data-table"><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Quyền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.fullName)}</td><td><b>${u.role === 'admin' ? 'Admin' : 'Nhân viên'}</b></td><td>${u.active ? 'Đang hoạt động' : 'Đã khóa'}</td><td><button class="btn small" onclick='userForm(${JSON.stringify(u)})'>Sửa</button> <button class="btn small danger" onclick="deleteUser(${u.id})">Khóa</button></td></tr>`).join('')}</tbody></table></div></div>`;
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
  confirmDelete({
    title: 'Khóa tài khoản?',
    message: 'Bạn có chắc muốn khóa tài khoản',
    item: u?.username ? u.username + '?' : 'này?',
    onConfirm: async () => {
      await api('/api/admin/users/' + id, {method:'DELETE'});
      toast('Đã khóa tài khoản');
      await renderUsers();
    }
  });
}

async function renderSettings() {
  const menu = await api('/api/menu');
  const categories = state.categories || [];
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Cài đặt</h1><p>Quản lý menu, danh mục, topping và QR chuyển khoản.</p></div></div><div class="report-grid"><section class="section-card"><div class="settings-section-head"><h3>Menu món</h3><button class="btn primary" onclick="menuForm()">+ Thêm món</button></div><div class="category-toolbar"><div><strong>Danh mục</strong><span class="muted"> Thêm, sửa hoặc xóa danh mục</span></div><button class="btn" onclick="categoryForm()">+ Thêm danh mục</button></div><div class="category-chips">${categories.map(c => `<div class="category-chip"><span>${esc(c.name)}</span><button type="button" onclick='categoryForm(${JSON.stringify(c)})' aria-label="Sửa danh mục">Sửa</button><button type="button" class="danger-text" onclick="deleteCategory(${c.id})" aria-label="Xóa danh mục">Xóa</button></div>`).join('')}</div><div class="table-card" style="margin-top:15px"><table class="data-table"><thead><tr><th>Món</th><th>Danh mục</th><th>Giá</th><th></th></tr></thead><tbody>${menu.map(m => `<tr><td><img class="avatar" src="${m.image || '/assets/logo.png'}">${esc(m.name)}</td><td>${esc(m.category)}</td><td>${money(m.price)}</td><td><button class="btn small" onclick='menuForm(${JSON.stringify(m)})'>Sửa</button> <button class="btn small danger" onclick="deleteMenu(${m.id})">Xóa</button></td></tr>`).join('')}</tbody></table></div></section><section class="section-card"><h3>QR chuyển khoản</h3><p class="muted">Ảnh này sẽ hiện cho nhân viên khi chọn chuyển khoản.</p>${state.qr ? `<img class="qr-preview" src="${state.qr}">` : '<div class="empty">Chưa có QR</div>'}<form id="qrForm" style="margin-top:14px"><input type="file" id="qrFile" accept="image/*"><button class="btn primary" style="margin-top:10px" type="submit">Upload QR</button></form><hr><div class="settings-section-head"><h3>Topping</h3><button class="btn" onclick="toppingForm()">+ Thêm topping</button></div><div>${state.toppings.map(t => `<div class="topping"><span>${esc(t.name)} · ${money(t.price)}</span><button class="btn small danger" onclick="deleteTop(${t.id})">Xóa</button></div>`).join('')}</div></section></div></div>`;
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
  openModal(`<h3>${m.id ? 'Sửa món' : 'Thêm món'}</h3><form id="menuForm"><div class="form-grid"><label>Tên món<input id="mName" value="${esc(m.name || '')}" required></label><label>Danh mục<div class="inline-select"><select id="mCat">${cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select><button type="button" class="btn small" onclick="window.__menuDraft={id:${m.id || 'null'},name:$('#mName').value,category:$('#mCat').value,price:$('#mPrice').value};closeModal();categoryForm({}, true)">+ Thêm</button></div></label><label>Giá<input id="mPrice" type="number" value="${m.price || 0}" min="0" required></label><label>Ảnh<input id="mImage" type="file" accept="image/*"></label></div><p class="form-hint">Bạn có thể tạo danh mục mới ngay tại đây bằng nút <b>+ Thêm</b>.</p><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form></div>`);
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
  const today = new Date().toISOString().slice(0,10);
  const month = today.slice(0,7);
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Doanh thu</h1><p>Chọn cách xem doanh thu.</p></div></div><div class="report-tabs"><button class="report-tab active" id="reportDayTab" onclick="showReportMode('day')">Theo ngày</button><button class="report-tab" id="reportMonthTab" onclick="showReportMode('month')">Theo tháng</button></div><div id="reportControls"></div><div id="reportArea"><div class="empty">Chọn ngày hoặc tháng để xem doanh thu</div></div></div>`;
  showReportMode('day');
}

function showReportMode(mode) {
  $('#reportDayTab')?.classList.toggle('active', mode === 'day');
  $('#reportMonthTab')?.classList.toggle('active', mode === 'month');
  const today = new Date().toISOString().slice(0,10);
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

function openModal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); window.__productDraft = null; window.__editIndex = null; }
window.closeModal = closeModal;

async function logout() { await api('/api/auth/logout',{method:'POST'}).catch(()=>{}); location.reload(); }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#loginUser').value,password:$('#loginPass').value})}); await boot(); }
  catch(e) { toast(e.message,true); }
});
$('#togglePass').onclick = () => { const i=$('#loginPass'); i.type=i.type==='password'?'text':'password'; $('#togglePass').textContent=i.type==='password'?'Hiện':'Ẩn'; };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleString('vi-VN',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});} setInterval(tick,1000); tick();

Object.assign(window,{go,logout,setCat,filterMenu,openProduct,addConfiguredProduct,changeQty,removeCart,clearCart,editCartItem,adjustTopModal,saveCartItem,selectPayment,checkout,completePayment,printOrder,userForm,saveUser,deleteUser,menuForm,saveMenu,deleteMenu,categoryForm,deleteCategory,toppingForm,saveTop,deleteTop,uploadQR,loadReport,confirmDelete,closeConfirmDelete,runConfirmDelete});
boot();
