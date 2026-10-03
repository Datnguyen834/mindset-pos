const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let state = {
  user: null,
  menu: [],
  categories: [],
  toppings: [],
  cart: [],
  category: 'Tất cả',
  bankAccount: { bankId:'', bankName:'', accountNo:'', accountName:'', template:'compact2' },
  bankList: [],
  payosConfig: {configured:false,source:null,clientId:'',apiKeyMasked:'',checksumKeyMasked:''},
  discountRules: [],
  page: 'pos',
  paymentMethod: 'cash',
  userList: null,
  settingsOpen: { categorySettings: false, menuSettings: false, toppingSettings: false, discountSettings: false, bankSettings: false },
  checkoutCustomer: { customer: null, redeem: false }, pendingCustomerSelection: null, customerPickerMode: 'checkout'
};

const money = (n) => new Intl.NumberFormat('vi-VN').format(Number(n) || 0) + 'đ';


// ==================== MÈO TƯƠNG TÁC TRÊN HEADER ====================
// Sprite sheet: 384x288 = 12 cột x 9 hàng, mỗi frame gốc 32x32.
// Các hàng trong asset được giữ nguyên để có thể dùng nhiều hành động:
// 0 idle, 1 walk, 2-3 run/fast movement, 4 lie/sleep,
// 5 sit/stand, 6 crouch/low walk, 7 play với bóng len, 8 leap/jump.
let catController = null;

function initInteractiveCat() {
  const track = $('#catTrack');
  const cat = $('#movingCat');
  if (!track || !cat || catController) return;

  // Sprite sheet 384x288: 12 cột x 9 hàng, mỗi frame 32x32.
  // Khi hiển thị, mỗi frame được phóng lên 80x80 để nhìn rõ hơn.
  const W = 80;
  const COLS = 12;
  const FRAME_MS = 105;
  const WALK_SPEED = 58;

  const row = (r, count = 12, start = 0) =>
    Array.from({ length: count }, (_, i) => [start + i, r]);

  // Các hàng animation lấy trực tiếp từ sprite sheet bạn gửi.
  const ANIM = {
    idle: row(0, 9),
    walk: row(1, 11),
    run: [...row(2, 12), ...row(3, 6)],
    crawl: row(4, 10),
    sit: row(5, 10),
    idle2: row(6, 10),
    play: row(7, 11),
    jump: row(8, 6),
  };

  // Sinh mèo ở một vị trí ngẫu nhiên trong vùng trắng ngay từ lúc khởi tạo.
  // Chừa một khoảng nhỏ quanh mép để mèo không bị dính góc màn hình.
  function randomSpawnPosition() {
    const maxX = Math.max(0, track.clientWidth - W);
    const maxY = Math.max(0, track.clientHeight - W);
    const padX = Math.min(90, maxX / 4);
    const padY = Math.min(90, maxY / 4);
    x = padX + Math.random() * Math.max(1, maxX - padX * 2);
    y = padY + Math.random() * Math.max(1, maxY - padY * 2);
  }

  let x = 0;
  let y = 0;
  randomSpawnPosition();
  // 8 hướng rõ ràng: trái, phải, lên, xuống và 4 đường chéo.
  // Tốc độ được chuẩn hóa để đi chéo không nhanh hơn đi thẳng.
  const DIRECTIONS = [
    [ 1, 0], [-1, 0], [0, 1], [0,-1],
    [ .707, .707], [ .707,-.707], [-.707, .707], [-.707,-.707]
  ];
  let dirX = 1;
  let dirY = 0;
  let directionTimer = null;

  function chooseDirection(preferred = null) {
    let candidates = DIRECTIONS;
    if (preferred) {
      candidates = DIRECTIONS.filter(([dx,dy]) => {
        return (preferred.x === 0 || Math.sign(dx) === preferred.x) &&
               (preferred.y === 0 || Math.sign(dy) === preferred.y);
      });
      if (!candidates.length) candidates = DIRECTIONS;
    }
    const [dx, dy] = candidates[Math.floor(Math.random() * candidates.length)];
    dirX = dx;
    dirY = dy;
    setDirectionClass();
  }

  function scheduleDirectionChange() {
    if (directionTimer) clearTimeout(directionTimer);
    directionTimer = setTimeout(() => {
      chooseDirection();
      scheduleDirectionChange();
    }, 2800 + Math.random() * 3200);
  }

  function clearDirectionTimer() {
    if (directionTimer) {
      clearTimeout(directionTimer);
      directionTimer = null;
    }
  }

  let mode = 'walk';
  let framePos = 0;
  let lastTime = performance.now();
  let lastFrameTime = lastTime;
  let reactionToken = 0;
  let actionTimer = null;
  let randomTimer = null;
  let dragging = false;
  let didDrag = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let clickCount = 0;

  function bounds() {
    return {
      maxX: Math.max(0, track.clientWidth - W),
      maxY: Math.max(0, track.clientHeight - W)
    };
  }

  function setDirectionClass() {
    cat.classList.toggle('face-left', dirX < 0);
  }

  function setFrame(frame) {
    const [col, r] = frame;
    cat.style.backgroundPosition = `${-(col * W)}px ${-(r * W)}px`;
    cat.style.backgroundSize = `${COLS * W}px ${9 * W}px`;
  }

  function nextFrame(now) {
    if (now - lastFrameTime < FRAME_MS) return;
    lastFrameTime = now;
    const frames = ANIM[mode] || ANIM.idle;
    framePos = (framePos + 1) % frames.length;
    setFrame(frames[framePos]);
  }

  function renderPosition() {
    const b = bounds();
    x = Math.max(0, Math.min(b.maxX, x));
    y = Math.max(0, Math.min(b.maxY, y));
    cat.style.left = `${x}px`;
    cat.style.top = `${y}px`;
  }

  function clearActionTimer() {
    if (actionTimer) {
      clearTimeout(actionTimer);
      actionTimer = null;
    }
  }

  function clearRandomTimer() {
    if (randomTimer) {
      clearTimeout(randomTimer);
      randomTimer = null;
    }
  }

  function resumeWalk() {
    mode = 'walk';
    framePos = 0;
    cat.classList.remove('reacting', 'dragging');
    lastFrameTime = performance.now();
    chooseDirection();
    setFrame(ANIM.walk[0]);
    scheduleDirectionChange();
    scheduleRandomAction();
  }

  function playAction(name, duration = 1000, fromClick = false) {
    clearActionTimer();
    clearRandomTimer();
    reactionToken++;
    const token = reactionToken;
    mode = name;
    framePos = 0;
    lastFrameTime = performance.now();
    if (fromClick) cat.classList.add('reacting');
    setFrame(ANIM[name][0]);

    actionTimer = setTimeout(() => {
      if (token !== reactionToken || dragging) return;
      cat.classList.remove('reacting');
      mode = 'walk';
      framePos = 0;
      lastFrameTime = performance.now();
      setDirectionClass();
      setFrame(ANIM.walk[0]);
      actionTimer = null;
      scheduleRandomAction();
    }, duration);
  }

  function runAction(duration = 1200) {
    clearActionTimer();
    clearRandomTimer();
    reactionToken++;
    const token = reactionToken;
    mode = 'run';
    framePos = 0;
    lastFrameTime = performance.now();
    cat.classList.add('reacting');
    setFrame(ANIM.run[0]);
    const started = performance.now();

    function runLoop(now) {
      if (token !== reactionToken || dragging || mode !== 'run') return;
      const dt = Math.min(40, now - lastTime);
      const b = bounds();
      x += dirX * 145 * dt / 1000;
      y += dirY * 145 * dt / 1000;
      if (x >= b.maxX) { x = b.maxX; dirX = -Math.abs(dirX || 1); setDirectionClass(); }
      else if (x <= 0) { x = 0; dirX = Math.abs(dirX || 1); setDirectionClass(); }
      if (y >= b.maxY) { y = b.maxY; dirY = -Math.abs(dirY || 1); }
      else if (y <= 0) { y = 0; dirY = Math.abs(dirY || 1); }
      renderPosition();
      nextFrame(now);
      if (now - started < duration) requestAnimationFrame(runLoop);
      else resumeWalk();
    }
    requestAnimationFrame(runLoop);
  }

  function randomAction() {
    if (dragging) return scheduleRandomAction();
    const actions = [
      ['idle', 3200], ['sit', 4200], ['crawl', 3000],
      ['idle2', 3500], ['play', 5200], ['jump', 2200], ['run', 4200]
    ];
    const [action, duration] = actions[Math.floor(Math.random() * actions.length)];
    if (action === 'run') runAction(duration);
    else playAction(action, duration, false);
  }

  function scheduleRandomAction() {
    clearRandomTimer();
    randomTimer = setTimeout(() => {
      randomAction();
    }, 4500 + Math.random() * 7500);
  }

  function react() {
    clickCount++;
    const reactions = [
      ['jump', 2400], ['play', 5200], ['sit', 4200],
      ['crawl', 3200], ['idle2', 3500], ['run', 4500]
    ];
    const [action, duration] = reactions[(clickCount - 1) % reactions.length];
    cat.classList.add('reacting');
    if (action === 'run') runAction(duration);
    else playAction(action, duration, true);
  }

  function pointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    clearActionTimer();
    clearRandomTimer();
    reactionToken++;
    dragging = true;
    didDrag = false;
    mode = 'drag';
    cat.classList.add('dragging');
    const r = cat.getBoundingClientRect();
    dragOffsetX = e.clientX - r.left;
    dragOffsetY = e.clientY - r.top;
    cat.setPointerCapture?.(e.pointerId);
  }

  function pointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const b = bounds();
    const trackRect = track.getBoundingClientRect();
    const nx = e.clientX - trackRect.left - dragOffsetX;
    const ny = e.clientY - trackRect.top - dragOffsetY;
    if (Math.abs(nx - x) + Math.abs(ny - y) > 5) didDrag = true;
    x = Math.max(0, Math.min(b.maxX, nx));
    y = Math.max(0, Math.min(b.maxY, ny));
    if (Math.abs(e.movementX || 0) > 0.5) dirX = e.movementX < 0 ? -1 : 1;
    setDirectionClass();
    framePos = 0;
    setFrame(ANIM.idle[0]);
    renderPosition();
  }

  function pointerUp(e) {
    if (!dragging) return;
    dragging = false;
    cat.releasePointerCapture?.(e.pointerId);
    cat.classList.remove('dragging');
    mode = 'walk';
    framePos = 0;
    chooseDirection();
    scheduleDirectionChange();
    setFrame(ANIM.walk[0]);
    if (didDrag) {
      // Không coi thao tác kéo là một cú click.
      setTimeout(() => { didDrag = false; }, 0);
    } else {
      react();
    }
    scheduleRandomAction();
  }

  cat.addEventListener('pointerdown', pointerDown);
  cat.addEventListener('pointermove', pointerMove);
  cat.addEventListener('pointerup', pointerUp);
  cat.addEventListener('pointercancel', pointerUp);
  cat.addEventListener('dragstart', e => e.preventDefault());

  catController = {
    stop() { mode = 'idle'; clearActionTimer(); clearRandomTimer(); clearDirectionTimer(); },
    react,
    randomSpawn() {
      clearActionTimer();
      clearRandomTimer();
      reactionToken++;
      dragging = false;
      mode = 'walk';
      randomSpawnPosition();
      chooseDirection();
      framePos = 0;
      lastFrameTime = performance.now();
      setFrame(ANIM.walk[0]);
      renderPosition();
      scheduleDirectionChange();
      scheduleRandomAction();
    }
  };

  chooseDirection();
  setFrame(ANIM.walk[0]);
  renderPosition();
  scheduleDirectionChange();
  scheduleRandomAction();

  function loop(now) {
    const dt = Math.min(40, now - lastTime);
    lastTime = now;

    if (!dragging && mode === 'walk') {
      const b = bounds();
      // Giữ đúng vector hướng: 8 hướng, gồm cả đi chéo rõ ràng.
      x += dirX * WALK_SPEED * dt / 1000;
      y += dirY * WALK_SPEED * dt / 1000;

      if (x >= b.maxX) {
        x = b.maxX;
        dirX = -Math.abs(dirX || 1);
        setDirectionClass();
      } else if (x <= 0) {
        x = 0;
        dirX = Math.abs(dirX || 1);
        setDirectionClass();
      }

      if (y >= b.maxY) {
        y = b.maxY;
        dirY = -Math.abs(dirY || 1);
      } else if (y <= 0) {
        y = 0;
        dirY = Math.abs(dirY || 1);
      }

      renderPosition();
      nextFrame(now);
    } else if (!dragging && mode !== 'run') {
      nextFrame(now);
      renderPosition();
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', renderPosition);
  requestAnimationFrame(loop);
}

// Ô nhập tiền: nhập số tự nhiên, không format khi đang gõ để tuyệt đối không nhảy con trỏ.
// Khi rời ô (blur), tự thêm dấu chấm hàng nghìn: 100000 -> 100.000.
function formatMoneyInput(el) {
  if (!el) return;
  const digits = String(el.value ?? '').replace(/\D/g, '');
  el.value = digits ? new Intl.NumberFormat('vi-VN').format(Number(digits)) : '';
}

function unformatMoneyInput(el) {
  if (!el) return;
  el.value = String(el.value ?? '').replace(/\D/g, '');
}

function moneyInputValue(id) {
  const el = $('#' + id);
  return Number(String(el?.value ?? '').replace(/\D/g, '')) || 0;
}

document.addEventListener('focusin', (e) => {
  if (e.target.matches('input.money-input')) unformatMoneyInput(e.target);
});

document.addEventListener('input', (e) => {
  if (e.target.matches('input.money-input')) {
    // Chỉ giữ chữ số trong lúc nhập; không thay đổi giá trị/caret bằng formatter.
    const el = e.target;
    const cleaned = String(el.value ?? '').replace(/\D/g, '');
    if (el.value !== cleaned) el.value = cleaned;
  }
});

document.addEventListener('focusout', (e) => {
  if (e.target.matches('input.money-input')) formatMoneyInput(e.target);
});

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
  const options = { credentials: 'same-origin', ...opt };
  const savedToken = localStorage.getItem('mindset_auth_token');
  if (savedToken) {
    options.headers = { ...(options.headers || {}), Authorization: `Bearer ${savedToken}` };
  }
  const r = await fetch(url, options);
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.message || 'Có lỗi xảy ra');
  return d;
}

function fmtDate(x) {
  return new Date(x).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function nav() {
  const admin = ['admin','manager'].includes(state.user.role);
  const items = admin
    ? [['pos','☕','Menu'],['orders','▣','Doanh thu'],['users','♙','Quản lý nhân viên'],['settings','⚙','Cài đặt']]
    : [['pos','☕','Menu']];
  $('#nav').innerHTML = items.map(([p, icon, label]) =>
    `<button class="nav-item ${state.page === p ? 'active' : ''}" onclick="go('${p}')"><span class="nav-icon">${icon}</span><span>${label}</span></button>`
  ).join('');
}

function setCatVisibility() {
  const track = $('#catTrack');
  if (!track) return;
  // Mèo chỉ xuất hiện trên trang Menu (POS).
  const shouldShow = state.page === 'pos';
  const wasHidden = track.classList.contains('cat-hidden');
  track.classList.toggle('cat-hidden', !shouldShow);

  // Mỗi lần quay lại Menu, cho mèo xuất hiện ở một vị trí ngẫu nhiên
  // trong vùng trắng thay vì luôn quay lại góc/trạng thái cũ.
  if (shouldShow && wasHidden && catController?.randomSpawn) {
    requestAnimationFrame(() => catController.randomSpawn());
  }
}

function go(p) {
  state.page = p;
  setCatVisibility();
  nav();
  renderPage();
}

async function boot({ animate = false } = {}) {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;

    // Đã xác thực thành công: lưu thông tin phiên ở phía trình duyệt để F5
    // vẫn khôi phục được POS ngay cả khi cookie bị trình duyệt/hosting bỏ qua.
    localStorage.setItem('mindset_auth_user', JSON.stringify(me.user));

    // Chuẩn bị toàn bộ dữ liệu trước khi mở POS để không thấy màn hình trắng.
    await loadBase();

    const loginView = $('#loginView');
    const appView = $('#appView');

    appView.classList.remove('hidden');
    initInteractiveCat();
    setCatVisibility();
    appView.classList.remove('app-enter');
    void appView.offsetWidth; // restart animation nếu đăng nhập lại
    if (animate) appView.classList.add('app-enter');

    $('#userName').textContent = state.user.fullName || state.user.username || '-';
    $('#roleText').textContent = state.user.role === 'admin' ? 'Admin tổng' : (state.user.role === 'manager' ? 'Quản lý' : 'Nhân viên');
    nav();
    renderPage();

    if (animate) {
      loginView.classList.add('login-exit');
      setTimeout(() => {
        loginView.classList.add('hidden');
        loginView.classList.remove('login-exit');
        appView.classList.remove('app-enter');
      }, 390);
    } else {
      loginView.classList.add('hidden');
    }
  } catch {}
}

async function loadBase() {
  // Tải song song thay vì chờ từng request xong mới chạy request tiếp theo.
  const payosPromise = state.user?.role === 'admin' ? api('/api/settings/payos').catch(() => ({configured:false,source:null,clientId:''})) : Promise.resolve({configured:false,source:null,clientId:''});
  const [menu, categories, toppings, bank, discountRules, banks, payosConfig] = await Promise.all([
    api('/api/menu'),
    api('/api/categories'),
    api('/api/toppings'),
    api('/api/settings/bank'),
    api('/api/settings/discount-rules'),
    api('/api/banks').catch(() => ({banks:[]})),
    payosPromise
  ]);

  state.menu = menu;
  state.categories = categories;
  state.toppings = toppings;
  state.bankAccount = bank.bank || { bankId:'', bankName:'', accountNo:'', accountName:'', template:'compact2' };
  state.bankList = Array.isArray(banks.banks) ? banks.banks : [];
  state.payosConfig = payosConfig || {configured:false,source:null,clientId:''};
  state.discountRules = Array.isArray(discountRules.rules) ? discountRules.rules : [];
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
          <button type="button" class="customer-cart-btn" id="customerCartBtn" onclick="openCustomerLoyaltyModal('cart')">
            <span>👤 Khách hàng</span><b id="customerCartStatus">Chưa chọn</b>
          </button>
          <div id="cartItems" class="cart-items"></div>
          <div class="cart-total">
            <div class="total-line"><span>Tạm tính</span><b id="subtotal">0đ</b></div>
            <div class="total-line discount-line" id="discountRow"><span class="discount-label">Total Discount</span><b id="cartDiscount">-0đ</b></div>
            <div class="discount-breakdown">
              <div class="discount-subline hidden" id="couponDiscountRow"><span>Discount coupon</span><b id="cartCouponDiscount">-0đ</b></div>
              <div class="discount-subline hidden" id="pointDiscountRow"><span>Discount point</span><b id="cartPointDiscount">-0đ</b></div>
            </div>
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
    <article class="menu-card" onclick="openProduct(${m.id}, this)">
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
        <select id="sugarPercent" onchange="updateProductModalPrice()">
          ${[0,30,50,70,100].map(v => `<option value="${v}" ${v === sugar ? 'selected' : ''}>${v}%</option>`).join('')}
        </select>
      </label>
      <label>% Đá
        <select id="icePercent" onchange="updateProductModalPrice()">
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

function normalizeCategoryName(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isBakeryProduct(m) {
  // Hỗ trợ cả món lấy trực tiếp từ menu và món đã nằm trong giỏ.
  // Một số dữ liệu cũ có thể lưu category khác dấu hoặc category='cake'.
  let category = m?.category;
  if (!category && m?.menuItemId && Array.isArray(state.menu)) {
    category = state.menu.find(item => Number(item.id) === Number(m.menuItemId))?.category;
  }
  const cat = normalizeCategoryName(category);
  return cat === 'banh ngot' || cat === 'cake' || cat.includes('banh ngot');
}

function cartItemSignature(item) {
  const toppings = (item.toppings || [])
    .map(t => ({ id: t.id ?? t.toppingId ?? t.name, name: t.name || '', price: Number(t.price || 0), quantity: Number(t.quantity || 0) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({
    menuItemId: Number(item.menuItemId),
    sugarPercent: Number(item.sugarPercent ?? 100),
    icePercent: Number(item.icePercent ?? 100),
    toppings
  });
}

function addToCartMerged(item) {
  const incoming = { ...item, quantity: Number(item.quantity || 1), toppings: item.toppings || [] };
  const signature = cartItemSignature(incoming);
  const existing = state.cart.find(x => cartItemSignature(x) === signature);

  if (existing) {
    existing.quantity = Number(existing.quantity || 0) + incoming.quantity;
  } else {
    state.cart.push({ ...incoming, key: crypto.randomUUID() });
  }
}

function animateProductToCart(imageSrc, sourceEl = null) {
  const cart = $('#cartItems');
  if (!cart) return Promise.resolve();

  const source = sourceEl?.querySelector?.('img') || document.querySelector('#modalBox .product-modal-head img');
  if (!source) return Promise.resolve();

  const from = source.getBoundingClientRect();
  const to = cart.getBoundingClientRect();
  const flyer = document.createElement('img');
  flyer.src = imageSrc || source.src || '/assets/logo.png';
  flyer.className = 'fly-to-cart';
  flyer.style.left = `${from.left}px`;
  flyer.style.top = `${from.top}px`;
  flyer.style.width = `${from.width}px`;
  flyer.style.height = `${from.height}px`;
  document.body.appendChild(flyer);

  const targetX = to.left + Math.min(42, Math.max(18, to.width * 0.08));
  const targetY = to.top + 28;
  const dx = targetX - from.left;
  const dy = targetY - from.top;

  requestAnimationFrame(() => {
    flyer.style.transform = `translate(${dx}px, ${dy}px) scale(.28) rotate(8deg)`;
    flyer.style.opacity = '0.25';
  });

  return new Promise(resolve => {
    setTimeout(() => { flyer.remove(); resolve(); }, 560);
  });
}

function updateProductModalPrice() {
  const priceNode = $('#modalProductPrice');
  const d = window.__productDraft;
  if (!priceNode || !d) return;
  const base = Number(priceNode.dataset.basePrice || 0);
  const toppingTotal = (d.toppings || []).reduce((sum, t) => sum + Number(t.price || 0) * Number(t.quantity || 0), 0);
  priceNode.textContent = money(base + toppingTotal);
}

function openProduct(id, sourceEl = null) {
  const m = state.menu.find(x => x.id === id);
  if (!m) return;

  // Bánh ngọt không có đường/đá/topping: bấm vào là thêm thẳng vào đơn.
  if (isBakeryProduct(m)) {
    addToCartMerged({
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
    animateProductToCart(m.image, sourceEl);
    toast('Đã thêm bánh vào đơn');
    return;
  }

  const temp = { toppings: [], sugarPercent: 100, icePercent: 100 };
  window.__productDraft = temp;
  openModal(`
    <div class="product-modal-head"><img src="${m.image || '/assets/logo.png'}"><div><div class="eyebrow">${esc(m.category)}</div><h3>${esc(m.name)}</h3><strong class="modal-price" id="modalProductPrice" data-base-price="${Number(m.price)}">${money(m.price)}</strong></div></div>
    ${productOptionsHtml('new', temp)}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick="addConfiguredProduct(${m.id})">Thêm vào đơn</button></div>`);
}

async function addConfiguredProduct(id) {
  const m = state.menu.find(x => x.id === id);
  const d = window.__productDraft || {};
  if (!m) return;

  addToCartMerged({
    menuItemId: m.id, name: m.name, price: Number(m.price), image: m.image,
    quantity: 1, category: m.category, toppings: d.toppings || [],
    sugarPercent: Number($('#sugarPercent').value), icePercent: Number($('#icePercent').value)
  });

  // Vẽ đơn trước để đích đến luôn tồn tại, nhưng giữ ảnh món để chạy hiệu ứng.
  drawCart();
  const flight = animateProductToCart(m.image);
  closeModal();
  await flight;
  toast('Đã thêm món vào đơn');
}

function cartSubtotal() {
  return state.cart.reduce((s, x) => s + (x.price + x.toppings.reduce((a, t) => a + t.price * t.quantity, 0)) * x.quantity, 0);
}

function cartDiscountInfo(subtotal = cartSubtotal()) {
  const rules = Array.isArray(state.discountRules) ? [...state.discountRules].sort((a,b)=>Number(b.threshold)-Number(a.threshold)) : [];
  const rule = rules.find(r => subtotal >= Number(r.threshold));
  const percent = rule ? Math.min(100, Math.max(0, Number(rule.percent)||0)) : 0;
  const amount = Math.min(subtotal, Math.round(subtotal * percent / 100));
  return { percent, amount, total: subtotal - amount };
}

const CUSTOMER_POINT_EARN_VALUE = 20000;
const CUSTOMER_POINT_DISCOUNT_VALUE = 1000;
function checkoutDiscountInfo(subtotal = cartSubtotal()) {
  const base = cartDiscountInfo(subtotal);
  const customer = state.checkoutCustomer?.customer;
  const points = customer && state.checkoutCustomer?.redeem ? Number(customer.points || 0) : 0;
  const pointsUsed = Math.min(points, Math.floor(base.total / CUSTOMER_POINT_DISCOUNT_VALUE));
  const pointsDiscount = pointsUsed * CUSTOMER_POINT_DISCOUNT_VALUE;
  return {
    ...base,
    pointsUsed,
    pointsDiscount,
    total: Math.max(0, base.total - pointsDiscount),
    amount: base.amount + pointsDiscount
  };
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
      <div class="cart-row${bakery ? ' bakery-cart-row' : ''}">
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
  const subtotal = cartSubtotal();
  const discountInfo = checkoutDiscountInfo(subtotal);
  const discountEl = $('#cartDiscount');
  const discountRow = $('#discountRow');
  const couponDiscountRow = $('#couponDiscountRow');
  const couponDiscountEl = $('#cartCouponDiscount');
  const pointDiscountRow = $('#pointDiscountRow');
  const pointDiscountEl = $('#cartPointDiscount');
  const customerBtn = $('#customerCartBtn');
  const customerStatus = $('#customerCartStatus');

  $('#subtotal').textContent = money(subtotal);
  if (discountEl) discountEl.textContent = `-${money(discountInfo.amount)}`;
  if (discountRow) discountRow.querySelector('.discount-label').textContent = 'Total Discount';

  if (couponDiscountRow && couponDiscountEl) {
    couponDiscountRow.classList.toggle('hidden', discountInfo.amount <= discountInfo.pointsDiscount);
    couponDiscountEl.textContent = `-${money(discountInfo.amount - discountInfo.pointsDiscount)}`;
  }

  if (pointDiscountRow && pointDiscountEl) {
    pointDiscountRow.classList.toggle('hidden', discountInfo.pointsDiscount <= 0);
    pointDiscountEl.textContent = `-${money(discountInfo.pointsDiscount)}`;
  }

  if (customerBtn && customerStatus) {
    const c = state.checkoutCustomer?.customer;
    if (c) {
      const used = discountInfo.pointsUsed;
      customerStatus.textContent = c.fullName;
      customerBtn.classList.add('has-customer');
    } else {
      customerStatus.textContent = 'Chưa chọn';
      customerBtn.classList.remove('has-customer');
    }
  }

  $('#cartTotal').textContent = money(discountInfo.total);
  $('#cartCount').textContent = `${state.cart.reduce((s, x) => s + x.quantity, 0)} món`;
}

function changeQty(i, d) { state.cart[i].quantity = Math.max(1, state.cart[i].quantity + d); drawCart(); }
function removeCart(i) { state.cart.splice(i, 1); drawCart(); }
function clearCart() { state.cart = []; state.checkoutCustomer = { customer: null, redeem: false }; state.pendingCustomerSelection = null; drawCart(); }

function editCartItem(i) {
  const x = state.cart[i];
  if (!x) return;
  if (isBakeryProduct(x)) return;
  window.__editIndex = i;
  window.__productDraft = { sugarPercent: x.sugarPercent, icePercent: x.icePercent, toppings: x.toppings.map(t => ({...t})) };
  openModal(`
    <div class="product-modal-head"><img src="${x.image || '/assets/logo.png'}"><div><div class="eyebrow">Tùy chỉnh món</div><h3>${esc(x.name)}</h3><strong class="modal-price" id="modalProductPrice" data-base-price="${Number(x.price)}">${money(x.price + (x.toppings || []).reduce((a,t)=>a+Number(t.price||0)*Number(t.quantity||0),0))}</strong></div></div>
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
  updateProductModalPrice();
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

function buildVietQrUrl(amount, addInfo='MINDSET') {
  const b = state.bankAccount || {};
  if (!b.bankId || !b.accountNo || !b.accountName || !amount) return '';
  const template = ['compact2','compact','qr_only','print'].includes(b.template) ? b.template : 'compact2';
  const bankId = encodeURIComponent(b.bankId);
  const accountNo = encodeURIComponent(b.accountNo);
  const qs = new URLSearchParams({ amount:String(Math.round(amount)), addInfo:String(addInfo).slice(0,50), accountName:b.accountName });
  return `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?${qs.toString()}`;
}

let transferPaymentPoll = null;
let transferPaymentOrderId = null;

async function checkout() {
  if (!state.cart.length) return toast('Hãy chọn ít nhất một món', true);
  continueCheckoutAfterLoyalty();
}

async function startTransferPayment() {
  const info = checkoutDiscountInfo();
  try {
    const d = await api('/api/orders', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      items: state.cart.map(x => ({menuItemId:x.menuItemId, quantity:x.quantity, sugarPercent:x.sugarPercent, icePercent:x.icePercent, toppings:x.toppings.map(t => ({id:t.id,quantity:t.quantity}))})),
      paymentMethod:'transfer',
      customerId: state.checkoutCustomer?.customer?.id || null,
      redeemPoints: !!state.checkoutCustomer?.redeem
    })});

    const p = await api('/api/payos/create-payment', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({orderId:d.orderId})
    });

    if (!p.qrCode) throw new Error('payOS không trả về mã QR cho đơn này');

    transferPaymentOrderId = d.orderId;
    renderTransferPaymentModal({
      orderId:d.orderId,
      total:d.total,
      qrCode:p.qrCode,
      checkoutUrl:p.checkoutUrl
    });
    beginTransferPaymentPolling(d.orderId);
  } catch (e) {
    toast(e.message || 'Không tạo được thanh toán chuyển khoản', true);
  }
}

function renderTransferPaymentModal(p) {
  const qrId = 'payosQrCanvas';
  openModal(`<div class="checkout-loyalty-summary payos-transfer-modal">
    <div class="eyebrow">Thanh toán chuyển khoản</div>
    <h3>Quét mã QR để thanh toán</h3>
    <p class="muted">Đơn <b>#${p.orderId}</b> · Số tiền <b>${money(p.total)}</b></p>
    <div class="payos-qr-wrap">
      <div class="payos-qr-stage">
        <img id="payosQrImage" class="payos-qr-image" alt="Mã QR thanh toán payOS" src="https://quickchart.io/qr?size=300&margin=0&ecLevel=H&text=${encodeURIComponent(p.qrCode)}">
        <canvas id="${qrId}" width="300" height="300" hidden></canvas>
      </div>
    </div>
    <div class="payos-waiting"><span class="payos-spinner"></span><b>Đang chờ ngân hàng xác nhận...</b></div>
    <div class="cash-summary">
      <div><span>Tổng bill</span><b>${money(p.total)}</b></div>
      <div><span>Trạng thái</span><b id="payosPaymentStatus">Chờ thanh toán</b></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="cancelTransferPayment()">Hủy</button>
    </div>
  </div>`);

  const qrImage = document.getElementById('payosQrImage');
  if (qrImage) {
    qrImage.addEventListener('error', () => {
      // Fallback to the bundled/browser QRCode library when the image service is unavailable.
      if (window.QRCode && document.getElementById(qrId)) {
        const canvas = document.getElementById(qrId);
        canvas.hidden = false;
        qrImage.style.display = 'none';
        QRCode.toCanvas(canvas, p.qrCode, {
          width: 300, margin: 2, errorCorrectionLevel: 'M'
        }, (err) => { if (err) console.error(err); });
      }
    }, {once:true});
  }
  if (qrImage && qrImage.complete && qrImage.naturalWidth === 0) qrImage.dispatchEvent(new Event('error'));
}

function beginTransferPaymentPolling(orderId) {
  if (transferPaymentPoll) clearInterval(transferPaymentPoll);
  transferPaymentPoll = setInterval(async () => {
    try {
      const d = await api(`/api/payos/payment-status/${orderId}`);
      const statusEl = $('#payosPaymentStatus');
      if (statusEl) statusEl.textContent = d.status === 'paid' ? 'Đã nhận tiền' : 'Chờ thanh toán';
      if (d.status === 'paid') {
        clearInterval(transferPaymentPoll);
        transferPaymentPoll = null;
        await finishPaidTransfer(orderId);
      }
    } catch (e) {
      // Keep polling while the modal is open; transient network errors are harmless.
    }
  }, 1200);
}

async function finishPaidTransfer(orderId) {
  try {
    const d = await api(`/api/orders/${orderId}`);
    state.cart = [];
    state.checkoutCustomer = {customer:null,redeem:false};
    closeModal();
    renderPOS();
    const customerResult = d.customer_id ? `<div class="customer-success-summary"><span>Khách hàng</span><b>${esc(d.customer_name || '')}</b></div>` : '';
    openModal(`<div class="success payment-success"><div class="check">✓</div><h3>Thanh toán thành công</h3><p>Đơn <b>#${d.id}</b> · Tổng tiền <b class="modal-total">${money(d.total)}</b></p>${customerResult}<p class="muted">payOS đã xác nhận tiền chuyển vào tài khoản.</p><p class="muted">Bạn có muốn in hóa đơn không?</p></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Bỏ qua</button><button class="btn primary" onclick="printOrder(${d.id})">In bill</button></div>`);
    toast(`Đã nhận chuyển khoản #${d.id} — ${money(d.total)}`);
  } catch (e) {
    toast(e.message || 'Đã nhận thanh toán nhưng không tải được hóa đơn', true);
  }
}

async function cancelTransferPayment() {
  if (transferPaymentPoll) {
    clearInterval(transferPaymentPoll);
    transferPaymentPoll = null;
  }
  const orderId = transferPaymentOrderId;
  if (!orderId) {
    transferPaymentOrderId = null;
    closeModal();
    return;
  }

  // Chỉ đóng modal sau khi backend đã hủy payment link trên payOS.
  // Như vậy QR cũ sẽ không còn là một yêu cầu thanh toán đang chờ.
  try {
    await api(`/api/payos/cancel-payment/${orderId}`, {method:'POST'});
    transferPaymentOrderId = null;
    closeModal();
    toast(`Đã hủy thanh toán đơn #${orderId}`);
  } catch (e) {
    // Nếu hủy trên payOS thất bại, giữ modal để người dùng biết QR vẫn còn hiệu lực.
    transferPaymentOrderId = orderId;
    toast(e.message || 'Không thể hủy thanh toán trên payOS', true);
  }
}

function continueCheckoutAfterLoyalty() {
  if (state.paymentMethod === 'transfer') {
    startTransferPayment();
  } else {
    openCashPaymentModal();
  }
}

async function searchCustomerForCheckout() {
  const input = $('#customerPhone');
  const phone = String(input?.value || '').replace(/\D/g, '');
  if (!phone) return toast('Nhập số điện thoại khách hàng', true);
  try {
    const d = await api(`/api/customers/search?phone=${encodeURIComponent(phone)}`);
    if (d.customer) {
      // Chỉ hiển thị thông tin sau khi tìm; chưa ghi nhận vào đơn.
      // Khách chỉ được ghi nhận khi nhân viên đóng modal bằng X hoặc click ra ngoài.
      state.pendingCustomerSelection = d.customer;
      renderCustomerFoundModal(d.customer, true);
    } else {
      renderCustomerNotFoundModal(phone);
    }
  } catch (e) { toast(e.message || 'Không tìm thấy khách hàng', true); }
}

function openCustomerLoyaltyModal(mode = 'cart') {
  state.customerPickerMode = mode;
  const currentCustomer = state.checkoutCustomer?.customer;

  // Nếu đơn đã có khách, bấm nút Khách hàng sẽ mở lại thông tin khách
  // để nhân viên có thể bấm Discount point sau khi đã chọn món.
  if (currentCustomer) {
    renderCustomerFoundModal();
    return;
  }

  openModal(`<div class="customer-loyalty-modal">
    <div class="customer-modal-head">
      <div><span class="eyebrow">Khách hàng</span><h3>Chọn khách hàng</h3><p class="muted">Tìm bằng số điện thoại để ghi nhận khách cho đơn.</p></div>
      <button class="modal-close-x" type="button" onclick="closeCustomerPicker()">×</button>
    </div>
    <div class="customer-search-row"><input id="customerPhone" inputmode="numeric" maxlength="15" placeholder="Nhập số điện thoại khách" onkeydown="if(event.key==='Enter')searchCustomerForCheckout()"><button class="btn primary" onclick="searchCustomerForCheckout()">Tìm</button></div>
    <button type="button" class="btn customer-skip-btn" onclick="closeCustomerPicker()">Đóng</button>
  </div>`);
}

function renderCustomerFoundModal(customer = null, isSearchPreview = false) {
  const c = customer || state.pendingCustomerSelection || state.checkoutCustomer?.customer;
  if (!c) return;
  const baseTotal = cartDiscountInfo().total;
  const possiblePoints = Math.min(Number(c.points || 0), Math.floor(baseTotal / CUSTOMER_POINT_DISCOUNT_VALUE));
  const alreadyRedeemed = !!state.checkoutCustomer?.redeem;
  const canRedeem = possiblePoints > 0 && !alreadyRedeemed && (state.checkoutCustomer?.customer ? true : (isSearchPreview && state.cart.length > 0));
  const redeemButtonClass = canRedeem ? 'customer-point-action active' : 'customer-point-action disabled';
  const redeemLabel = alreadyRedeemed ? 'Đã dùng điểm' : 'Discount point';

  openModal(`<div class="customer-loyalty-modal">
    <div class="customer-modal-head">
      <div><span class="eyebrow">Khách hàng</span><h3>${esc(c.fullName)}</h3><p class="muted">${esc(c.phone)}</p></div>
      <button class="modal-close-x" type="button" onclick="closeCustomerPicker()">×</button>
    </div>
    <div class="customer-point-card">
      <div><span>Số điểm hiện có</span><strong>${Number(c.points || 0)} điểm</strong></div>
      <div><span>Tổng chi tiêu</span><strong>${money(Number(c.totalSpend || 0))}</strong></div>
    </div>
    <button type="button" class="${redeemButtonClass}" ${canRedeem ? `onclick="chooseCustomerOption(true)"` : 'disabled'}>
      <span>${redeemLabel}</span>
    </button>
  </div>`);
}

function chooseCustomerOption(redeem) {
  // Nếu đang xem kết quả tìm kiếm, chỉ khi bấm Discount point mới ghi nhận khách vào đơn.
  if (state.pendingCustomerSelection) {
    state.checkoutCustomer = { customer: state.pendingCustomerSelection, redeem: false };
    state.pendingCustomerSelection = null;
  }
  state.checkoutCustomer.redeem = !!redeem;
  if (state.customerPickerMode === 'cart') {
    closeModal();
    drawCart();
    toast(redeem ? `Đã dùng ${checkoutDiscountInfo().pointsUsed} điểm` : 'Đã chọn khách hàng');
    return;
  }
  continueCheckoutAfterLoyalty();
}

function renderCustomerNotFoundModal(phone) {
  openModal(`<div class="customer-loyalty-modal">
    <div class="customer-modal-head">
      <div><span class="eyebrow">Khách hàng</span><h3>Chưa có tài khoản</h3><p class="muted">Số ${esc(phone)} chưa được đăng ký.</p></div>
      <button class="modal-close-x" type="button" onclick="closeCustomerPicker()">×</button>
    </div>
    <div class="customer-not-found"><strong>Không tìm thấy khách hàng.</strong><span>Bạn có muốn tạo tài khoản mới để bắt đầu tích điểm không?</span></div>
    <div class="modal-actions"><button class="btn" onclick="closeCustomerPicker()">Không, bỏ qua</button><button class="btn primary" onclick="showCreateCustomerForm('${esc(phone)}')">Có, tạo tài khoản</button></div>
  </div>`);
}

function showCreateCustomerForm(phone) {
  openModal(`<div class="customer-loyalty-modal">
    <div class="customer-modal-head">
      <div><span class="eyebrow">Khách hàng mới</span><h3>Tạo tài khoản</h3><p class="muted">Số điện thoại: ${esc(phone)}</p></div>
      <button class="modal-close-x" type="button" onclick="closeCustomerPicker()">×</button>
    </div>
    <label class="customer-name-label">Họ tên khách hàng<input id="newCustomerName" autocomplete="name" placeholder="Nhập họ tên"></label>
    <div class="modal-actions"><button class="btn" onclick="renderCustomerNotFoundModal('${esc(phone)}')">Quay lại</button><button class="btn primary" onclick="createCustomerAndContinue('${esc(phone)}')">Tạo tài khoản</button></div>
  </div>`);
}

async function createCustomerAndContinue(phone) {
  const fullName = String($('#newCustomerName')?.value || '').trim();
  if (!fullName) return toast('Nhập họ tên khách hàng', true);
  try {
    const d = await api('/api/customers', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({phone,fullName})});
    state.checkoutCustomer = { customer: d.customer, redeem: false };
    if (state.customerPickerMode === 'cart') {
      closeModal();
      drawCart();
      toast(`Đã chọn khách hàng ${d.customer.fullName}`);
    } else {
      continueCheckoutAfterLoyalty();
    }
  } catch (e) { toast(e.message || 'Không tạo được tài khoản', true); }
}

function closeCustomerPicker() {
  if (state.pendingCustomerSelection) {
    state.checkoutCustomer = { customer: state.pendingCustomerSelection, redeem: false };
    state.pendingCustomerSelection = null;
    drawCart();
    toast(`Đã chọn khách hàng ${state.checkoutCustomer.customer.fullName}`);
  }
  closeModal();
}

function skipCustomerAndContinue() {
  state.checkoutCustomer = { customer: null, redeem: false };
  if (state.customerPickerMode === 'cart') {
    closeModal();
    drawCart();
    return;
  }
  continueCheckoutAfterLoyalty();
}

const CASH_DENOMINATIONS = [500000,200000,100000,50000,20000,10000,5000,2000,1000];
let cashPaymentState = { counts: {} };

function cashReceived() {
  return CASH_DENOMINATIONS.reduce((sum, value) => sum + value * Number(cashPaymentState.counts[value] || 0), 0);
}

function changeCashDenomination(value, delta = 1) {
  const info = checkoutDiscountInfo();
  const received = cashReceived();
  if (received >= info.total) return;
  const current = Number(cashPaymentState.counts[value] || 0);
  cashPaymentState.counts[value] = Math.max(0, current + Math.max(0, delta));
  renderCashPaymentModal();
}

function clearCashDenominations() {
  cashPaymentState = { counts: {} };
  renderCashPaymentModal();
}

function renderCashPaymentModal() {
  const info = checkoutDiscountInfo();
  const received = cashReceived();
  const change = Math.max(0, received - info.total);
  const missing = Math.max(0, info.total - received);
  const rows = CASH_DENOMINATIONS.map(value => {
    const count = Number(cashPaymentState.counts[value] || 0);
    const locked = received >= info.total;
    return `<button type="button" class="cash-denom ${locked ? 'cash-denom-locked' : ''}" onclick="changeCashDenomination(${value},1)" aria-disabled="${locked}" ${locked ? 'disabled' : ''}><span class="cash-denom-value">${money(value)}</span><span class="cash-denom-controls"><b>${count}</b><span class="cash-plus ${locked ? 'cash-plus-disabled' : ''}">+</span></span></button>`;
  }).join('');
  const status = missing > 0 ? `<div class="cash-missing">Còn thiếu <b>${money(missing)}</b></div>` : `<div class="cash-change">Tiền thối lại <b>${money(change)}</b></div>`;
  openModal(`<div class="cash-payment-modal"><div class="cash-payment-title"><div><span class="eyebrow">Thanh toán</span><h3>Tiền mặt</h3></div><div class="cash-total-badge">${money(info.total)}</div></div><div class="cash-summary"><div><span>Tổng bill</span><b>${money(info.total)}</b></div><div><span>Tiền khách đưa</span><b id="cashReceivedDisplay">${money(received)}</b></div><div>${status}</div></div><div class="cash-loyalty-line">${state.checkoutCustomer?.customer ? `Khách: <b>${esc(state.checkoutCustomer.customer.fullName)}</b>${state.checkoutCustomer.redeem ? ` · Trừ ${info.pointsUsed} điểm (-${money(info.pointsDiscount)})` : ''}` : 'Không tích điểm cho hóa đơn này'}</div><div class="cash-denom-heading"><div class="cash-denom-title">Chọn mệnh giá khách đưa</div><button type="button" class="btn cash-clear-btn" onclick="clearCashDenominations()">Xóa đã chọn</button></div><div class="cash-denom-grid">${rows}</div><div class="cash-payment-footer"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" ${received < info.total ? 'disabled' : ''} onclick="confirmCashPayment()">Xác nhận thanh toán</button></div></div>`);
}

function openCashPaymentModal() { cashPaymentState = { counts: {} }; renderCashPaymentModal(); }

async function confirmCashPayment() {
  const total = checkoutDiscountInfo().total;
  const received = cashReceived();
  if (received < total) return toast(`Khách còn thiếu ${money(total - received)}`, true);
  await completePayment('cash', { received, change: received - total });
}

async function completePayment(method, cashMeta = null) {
  try {
    const d = await api('/api/orders', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      items: state.cart.map(x => ({menuItemId:x.menuItemId, quantity:x.quantity, sugarPercent:x.sugarPercent, icePercent:x.icePercent, toppings:x.toppings.map(t => ({id:t.id,quantity:t.quantity}))})),
      paymentMethod:method,
      cashReceived: cashMeta?.received || null,
      cashChange: cashMeta?.change || null,
      customerId: state.checkoutCustomer?.customer?.id || null,
      redeemPoints: !!state.checkoutCustomer?.redeem
    })});
    const customerResult = d.customer ? `<div class="customer-success-summary"><span>Khách hàng</span><b>${esc(d.customer.fullName)}</b><span>Điểm hiện tại</span><b>${Number(d.customer.points || 0)} điểm</b>${d.pointsUsed ? `<span>Đã trừ</span><b>${d.pointsUsed} điểm (-${money(d.pointsDiscount)})</b>` : ''}${d.pointsEarned ? `<span>Tích thêm</span><b>+${d.pointsEarned} điểm</b>` : ''}</div>` : '';
    state.cart = [];
    state.checkoutCustomer = {customer:null,redeem:false};
    closeModal();
    renderPOS();
    openModal(`<div class="success payment-success"><div class="check">✓</div><h3>Thanh toán thành công</h3><p>Đơn <b>#${d.orderId}</b> · Discount <b>${d.discountPercent || 0}%</b>${d.pointsDiscount ? ` · Điểm giảm <b>-${money(d.pointsDiscount)}</b>` : ''} · Tổng tiền <b class="modal-total">${money(d.total)}</b></p>${customerResult}${method === 'cash' && cashMeta ? `<div class="cash-success-summary"><div><span>Tiền khách đưa</span><b>${money(cashMeta.received)}</b></div><div><span>Tiền thối lại</span><b>${money(cashMeta.change)}</b></div></div>` : ''}<p class="muted">Bạn có muốn in hóa đơn không?</p></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Bỏ qua</button><button class="btn primary" onclick="printOrder(${d.orderId})">In bill</button></div>`);
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
  const customerLine = o.customer_id ? `<br>Khách hàng: ${esc(o.customer_name || 'Khách hàng')}${o.points_earned ? ` · +${o.points_earned} điểm` : ''}` : '';
  const automaticDiscount = Number(o.automatic_discount || 0);
  const pointsDiscount = Number(o.points_discount || 0);
  openModal(`<div class="invoice"><h1>Mindset</h1><p style="text-align:center">HÓA ĐƠN #${o.id}</p><p>${fmtDate(o.created_at)}<br>Nhân viên: ${esc(o.staff)}${customerLine}</p><table>${o.items.map(x => `<tr><td><strong>${esc(x.item_name)} x${x.quantity}</strong><br><small>Đường ${x.sugar_percent}% · Đá ${x.ice_percent}%<br>${x.toppings.map(t => esc(t.name)).join(', ') || 'Không topping'}</small></td><td class="r">${money(x.line_total)}</td></tr>`).join('')}</table><hr><div class="invoice-summary"><p class="r">Tạm tính: ${money(o.subtotal)}</p><p class="r">Discount${automaticDiscount ? ` ${Math.round((automaticDiscount / Math.max(1, Number(o.subtotal))) * 100)}%` : ''}: -${money(automaticDiscount)}</p>${pointsDiscount ? `<p class="r">Trừ điểm: -${money(pointsDiscount)}</p>` : ''}<p class="r"><b>TỔNG: ${money(o.total)}</b></p></div><p style="text-align:center">Cảm ơn quý khách!</p></div><div class="modal-actions no-print"><button class="btn" onclick="window.print()">In</button><button class="btn" onclick="closeModal()">Đóng</button></div>`);
}

function renderUsersTable(users) {
  state.userList = users;
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Quản lý nhân viên</h1><p>Tạo tài khoản, đổi mật khẩu và phân quyền.</p></div><button class="btn primary" onclick="userForm()">+ Thêm tài khoản</button></div><div class="table-card"><table class="data-table"><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Quyền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.fullName)}</td><td><b>${u.role === 'admin' ? 'Admin tổng' : (u.role === 'manager' ? 'Quản lý' : 'Nhân viên')}</b></td><td>${u.active ? 'Đang hoạt động' : 'Đã khóa'}</td><td>${u.username === 'admin' ? '<span class="muted">Bảo vệ</span>' : `<button class="btn small" onclick='userForm(${JSON.stringify(u)})'>Sửa</button> <button class="btn small danger" onclick="deleteUser(${u.id})">Xóa</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
}

async function renderUsers(forceRefresh = false) {
  // Có cache thì mở trang ngay, không chờ database.
  if (!forceRefresh && Array.isArray(state.userList)) {
    renderUsersTable(state.userList);
    return;
  }

  // Hiển thị khung trang ngay cả khi request database chưa trả về.
  $('#page').innerHTML = `<div class="content"><div class="page-title"><div><h1>Quản lý nhân viên</h1><p>Tạo tài khoản, đổi mật khẩu và phân quyền.</p></div><button class="btn primary" onclick="userForm()">+ Thêm tài khoản</button></div><div class="table-card"><div class="empty">Đang tải danh sách nhân viên...</div></div></div>`;

  try {
    const users = await api('/api/admin/users');
    renderUsersTable(users);
  } catch (e) {
    $('#page').querySelector('.empty')?.replaceChildren(document.createTextNode(e.message || 'Không tải được danh sách nhân viên'));
    toast(e.message || 'Không tải được dữ liệu', true);
  }
}

function userForm(u = {}) {
  openModal(`<h3>${u.id ? 'Sửa tài khoản' : 'Thêm tài khoản'}</h3><div class="form-grid"><label>Tài khoản<input id="fUsername" value="${esc(u.username || '')}" ${u.id ? 'disabled' : ''}></label><label>Họ tên<input id="fFullName" value="${esc(u.fullName || '')}"></label><label>Mật khẩu<input id="fPassword" type="password" placeholder="${u.id ? 'Để trống nếu không đổi' : ''}"></label><label>Quyền<select id="fRole"><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Nhân viên</option><option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Quản lý</option></select></label></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" onclick='saveUser(${u.id || 'null'})'>Lưu</button></div>`);
}

async function saveUser(id) {
  try {
    const body = { fullName:$('#fFullName').value, role:$('#fRole').value };
    if ($('#fPassword').value) body.password = $('#fPassword').value;
    if (!id) { body.username = $('#fUsername').value; if (!body.password) throw new Error('Cần nhập mật khẩu'); }
    await api(id ? `/api/admin/users/${id}` : '/api/admin/users', { method:id ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    closeModal();
    state.userList = null;
    toast('Đã lưu');
    renderUsers(true);
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
      state.userList = null;
      await renderUsers(true);
    }
  });
}

async function renderSettings() {
  // Menu, danh mục, topping và QR đã được nạp khi boot.
  // Không gọi database lại mỗi lần chuyển sang tab Cài đặt.
  const menu = state.menu || [];
  const categories = state.categories || [];

  $('#page').innerHTML = `
    <div class="content settings-content">
      <div class="page-title">
        <div>
          <h1>Cài đặt</h1>
          <p>Quản lý menu, danh mục, topping và QR chuyển khoản.</p>
        </div>
      </div>

      <div class="settings-layout">
        <section class="section-card settings-main-card">

          <div class="settings-accordion">
            <button type="button" class="settings-accordion-head" onclick="toggleSettingsSection('categorySettings')">
              <span>
                <strong>Danh mục</strong>
                <small>${categories.length} danh mục · Bấm để xem và chỉnh sửa</small>
              </span>
              <span class="settings-chevron ${state.settingsOpen.categorySettings ? 'open' : ''}" id="categorySettingsChevron">⌄</span>
            </button>
            <div class="settings-accordion-body ${state.settingsOpen.categorySettings ? '' : 'hidden'}" id="categorySettings">
              <div class="settings-section-toolbar">
                <span class="muted">Danh sách danh mục</span>
                <button class="btn primary" onclick="categoryForm()">+ Thêm danh mục</button>
              </div>
              <div class="category-actions">
                <div class="category-chips">
                  ${categories.map(c => `
                    <div class="category-chip">
                      <span>${esc(c.name)}</span>
                      <button type="button" onclick='categoryForm(${JSON.stringify(c)})'>Sửa</button>
                      <button type="button" class="danger-text" onclick="deleteCategory(${c.id})">Xóa</button>
                    </div>
                  `).join('') || '<div class="empty">Chưa có danh mục</div>'}
                </div>
              </div>
            </div>
          </div>

          <div class="settings-accordion">
            <button type="button" class="settings-accordion-head" onclick="toggleSettingsSection('menuSettings')">
              <span>
                <strong>Menu món</strong>
                <small>${menu.length} món · Bấm để xem và chỉnh sửa</small>
              </span>
              <span class="settings-chevron ${state.settingsOpen.menuSettings ? 'open' : ''}" id="menuSettingsChevron">⌄</span>
            </button>
            <div class="settings-accordion-body ${state.settingsOpen.menuSettings ? '' : 'hidden'}" id="menuSettings">
              <div class="settings-section-toolbar">
                <span class="muted">Danh sách món</span>
                <button class="btn primary" onclick="menuForm()">+ Thêm món</button>
              </div>
              <div class="table-card">
                <table class="data-table">
                  <thead>
                    <tr><th>Món</th><th>Danh mục</th><th>Giá</th><th>Thao tác</th></tr>
                  </thead>
                  <tbody>
                    ${menu.map(m => `
                      <tr>
                        <td><img class="avatar" src="${m.image || '/assets/logo.png'}">${esc(m.name)}</td>
                        <td>${esc(m.category)}</td>
                        <td>${money(m.price)}</td>
                        <td>
                          <button class="btn small" onclick='menuForm(${JSON.stringify(m)})'>Sửa</button>
                          <button class="btn small danger" onclick="deleteMenu(${m.id})">Xóa</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="settings-accordion">
            <button type="button" class="settings-accordion-head" onclick="toggleSettingsSection('toppingSettings')">
              <span>
                <strong>Topping</strong>
                <small>${state.toppings.length} topping · Bấm để xem và chỉnh sửa</small>
              </span>
              <span class="settings-chevron ${state.settingsOpen.toppingSettings ? 'open' : ''}" id="toppingSettingsChevron">⌄</span>
            </button>
            <div class="settings-accordion-body ${state.settingsOpen.toppingSettings ? '' : 'hidden'}" id="toppingSettings">
              <div class="settings-section-toolbar">
                <span class="muted">Danh sách topping</span>
                <button class="btn primary" onclick="toppingForm()">+ Thêm topping</button>
              </div>
              <div class="settings-topping-list">
                ${state.toppings.map(t => `
                  <div class="topping settings-topping-row">
                    <span><strong>${esc(t.name)}</strong> · ${money(t.price)}</span>
                    <div>
                      <button class="btn small" onclick='toppingForm(${JSON.stringify(t)})'>Sửa</button>
                      <button class="btn small danger" onclick="deleteTop(${t.id})">Xóa</button>
                    </div>
                  </div>
                `).join('') || '<div class="empty">Chưa có topping</div>'}
              </div>
            </div>
          </div>

          <div class="settings-accordion">
            <button type="button" class="settings-accordion-head" onclick="toggleSettingsSection('discountSettings')">
              <span>
                <strong>Discount</strong>
                <small>${state.discountRules.length} mức giảm · Tự động áp dụng theo giá trị hóa đơn</small>
              </span>
              <span class="settings-chevron ${state.settingsOpen.discountSettings ? 'open' : ''}" id="discountSettingsChevron">⌄</span>
            </button>
            <div class="settings-accordion-body ${state.settingsOpen.discountSettings ? '' : 'hidden'}" id="discountSettings">
              <div class="settings-section-toolbar">
                <span class="muted">Ví dụ: Hóa đơn từ 100.000đ → giảm 10%</span>
                <button class="btn primary" onclick="discountForm()">+ Thêm discount</button>
              </div>
              <div class="settings-topping-list">
                ${state.discountRules.length ? [...state.discountRules].sort((a,b)=>a.threshold-b.threshold).map(r => `
                  <div class="topping settings-topping-row">
                    <span><strong>Giảm ${Number(r.percent)}%</strong> · Hóa đơn từ ${money(r.threshold)}</span>
                    <button class="btn small danger" onclick="deleteDiscountRule(${Number(r.threshold)})">Xóa</button>
                  </div>`).join('') : '<div class="empty">Chưa có mức discount</div>'}
              </div>
            </div>
          </div>

        </section>

        <section class="section-card settings-qr-card settings-bank-card">
          <button type="button" class="settings-accordion-head" onclick="toggleSettingsSection('bankSettings')">
            <span>
              <strong>Tài khoản ngân hàng</strong>
              <small>Cấu hình VietQR · Bấm để xem và chỉnh sửa</small>
            </span>
            <span class="settings-chevron ${state.settingsOpen.bankSettings ? 'open' : ''}" id="bankSettingsChevron">⌄</span>
          </button>
          <div class="settings-accordion-body ${state.settingsOpen.bankSettings ? '' : 'hidden'}" id="bankSettings">
            <p class="muted">Mỗi lần thanh toán, QR được tạo động theo đúng số tiền thực tế. Admin tổng có thể đổi kênh payOS ngay tại đây.</p>
            <form id="bankForm" style="margin-top:14px">
              <div class="form-grid">
                <label>Ngân hàng<select id="bankId" required><option value="">Chọn ngân hàng</option>${(state.bankList||[]).map(b => `<option value="${esc(String(b.bin||b.id||''))}" data-name="${esc(b.shortName||b.name||'')}" ${String(b.bin||b.id||'')===String(state.bankAccount.bankId||'')?'selected':''}>${esc(b.shortName ? `${b.shortName} · ${b.name}` : b.name || '')}</option>`).join('')}</select></label>
                <label>Số tài khoản<input id="bankAccountNo" inputmode="numeric" maxlength="19" value="${esc(state.bankAccount.accountNo||'')}" placeholder="Số tài khoản" required></label>
                <label>Tên tài khoản<input id="bankAccountName" maxlength="50" value="${esc(state.bankAccount.accountName||'')}" placeholder="NGUYEN VAN A" required></label>
                <label>Mẫu QR<select id="bankTemplate"><option value="compact2" ${state.bankAccount.template==='compact2'?'selected':''}>compact2 · QR + thông tin</option><option value="compact" ${state.bankAccount.template==='compact'?'selected':''}>compact · QR</option><option value="qr_only" ${state.bankAccount.template==='qr_only'?'selected':''}>qr_only · Chỉ QR</option><option value="print" ${state.bankAccount.template==='print'?'selected':''}>print · Đầy đủ</option></select></label>
              </div>
              ${state.user?.role === 'admin' ? `
              <div class="settings-block payos-credentials-block" style="margin-top:16px">
                <h3>Kênh thanh toán payOS</h3>
                <p class="settings-block-desc">Nhập bộ key của kênh payOS muốn sử dụng. Key được lưu mã hóa trong cơ sở dữ liệu, không cần sửa biến môi trường trên Render.</p>
                <div class="form-grid" style="margin-top:10px">
                  <label>Client ID<input id="payosClientId" value="${esc(state.payosConfig.clientId||'')}" placeholder="Client ID" autocomplete="off"></label>
                  <label>API Key<input id="payosApiKey" type="password" value="" placeholder="${state.payosConfig.apiKeyMasked ? `Đã lưu ${esc(state.payosConfig.apiKeyMasked)}` : 'API Key'}" autocomplete="new-password"></label>
                  <label>Checksum Key<input id="payosChecksumKey" type="password" value="" placeholder="${state.payosConfig.checksumKeyMasked ? `Đã lưu ${esc(state.payosConfig.checksumKeyMasked)}` : 'Checksum Key'}" autocomplete="new-password"></label>
                  <div class="form-hint" style="align-self:end">${state.payosConfig.configured ? `Kênh đang dùng: <b>${esc(state.payosConfig.clientId||'')}</b> · ${state.payosConfig.source === 'database' ? 'được lưu trong hệ thống' : 'đang lấy từ Render'}. Để đổi kênh, nhập key mới.` : 'Chưa có kênh payOS trong hệ thống. Hãy nhập đủ 3 key.'}</div>
                </div>
              </div>` : ''}
              <div id="bankQrPreview" style="margin-top:16px;text-align:center"></div>
              <button class="btn primary" style="margin-top:10px" type="submit">${state.user?.role === 'admin' ? 'Lưu tài khoản & kênh thanh toán' : 'Lưu tài khoản ngân hàng'}</button>
            </form>
          </div>
        </section>
      </div>
    </div>`;

  $('#bankForm').onsubmit = saveBankAccount;
  const bankIdEl = $('#bankId');
  if (bankIdEl) bankIdEl.addEventListener('change', () => { const opt=bankIdEl.selectedOptions[0]; if(opt?.dataset?.name) $('#bankAccountName').value = state.bankAccount.accountName || ''; });
  renderBankPreview();
}

function toggleSettingsSection(sectionId) {
  const body = $('#' + sectionId);
  if (!body) return;

  const willOpen = body.classList.contains('hidden');
  state.settingsOpen[sectionId] = willOpen;
  body.classList.toggle('hidden', !willOpen);

  const chevron = $('#' + sectionId + 'Chevron');
  if (chevron) chevron.classList.toggle('open', willOpen);
}

function discountForm() {
  openModal(`<h3>Thêm discount</h3><form id="discountForm"><div class="form-grid"><label>Hóa đơn từ<input id="discountThreshold" class="money-input" type="text" inputmode="numeric" autocomplete="off" placeholder="100.000" required></label><label>Giảm<input id="discountPercent" type="number" min="1" max="100" step="1" placeholder="10" required></label></div><p class="muted">Nhân viên không cần chọn % discount. Hệ thống tự áp dụng mức phù hợp khi thanh toán.</p><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`);
  $('#discountForm').onsubmit = async e => {
    e.preventDefault();
    const threshold=moneyInputValue('discountThreshold'), percent=Number($('#discountPercent').value);
    try {
      await api('/api/admin/discount-rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threshold,percent})});
      await loadBase();
      state.settingsOpen.discountSettings=true;
      closeModal();
      renderSettings();
      toast('Đã lưu mức discount');
    } catch(e){ toast(e.message,true); }
  };
}

async function deleteDiscountRule(threshold) {
  confirmDelete({title:'Xóa mức discount?',message:'Bạn có chắc muốn xóa mức giảm cho hóa đơn từ',item:money(threshold)+'?',onConfirm:async()=>{
    await api('/api/admin/discount-rules/'+threshold,{method:'DELETE'});
    await loadBase();
    state.settingsOpen.discountSettings=true;
    renderSettings();
    toast('Đã xóa mức discount');
  }});
}
window.discountForm=discountForm;
window.deleteDiscountRule=deleteDiscountRule;

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
      state.settingsOpen.categorySettings = true;
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
      state.settingsOpen.categorySettings = true;
      await renderSettings();
      toast('Đã xóa danh mục');
    }
  });
}

function menuForm(m = {}) {
  const cats = state.categories || [];
  openModal(`<h3>${m.id ? 'Sửa món' : 'Thêm món'}</h3><form id="menuForm"><div class="form-grid"><label>Tên món<input id="mName" value="${esc(m.name || '')}" required></label><label>Danh mục<select id="mCat">${cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select></label><label>Giá<input id="mPrice" class="money-input" type="text" inputmode="numeric" autocomplete="off" value="${m.price ? new Intl.NumberFormat('vi-VN').format(Number(m.price)) : ''}" placeholder="50.000" required></label><label>Ảnh<input id="mImage" type="file" accept="image/*"></label></div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form></div>`);
  if (m.category) $('#mCat').value = m.category;
  $('#menuForm').onsubmit = e => saveMenu(e, m.id);
}

async function saveMenu(e, id) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('name', $('#mName').value); fd.append('category', $('#mCat').value); fd.append('price', String(moneyInputValue('mPrice')));
  if ($('#mImage').files[0]) fd.append('image', $('#mImage').files[0]);
  try { await api(id ? `/api/admin/menu/${id}` : '/api/admin/menu', {method:id ? 'PUT' : 'POST', body:fd}); closeModal(); await loadBase(); state.settingsOpen.menuSettings = true; toast('Đã lưu món'); renderSettings(); }
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
      state.settingsOpen.menuSettings = true;
      await renderSettings();
      toast('Đã xóa sản phẩm');
    }
  });
}
function toppingForm(t = {}) {
  openModal(`
    <h3>${t.id ? 'Sửa topping' : 'Thêm topping'}</h3>
    <label>Tên topping<input id="tName" value="${esc(t.name || '')}" required></label>
    <label>Giá<input id="tPrice" class="money-input" type="text" inputmode="numeric" autocomplete="off" value="${t.price ? new Intl.NumberFormat('vi-VN').format(Number(t.price)) : ''}" placeholder="10.000" required></label>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Hủy</button>
      <button class="btn primary" onclick="saveTop(${t.id || 'null'})">Lưu</button>
    </div>`);
}
async function saveTop(id = null) {
  const body = {name:$('#tName').value.trim(), price:moneyInputValue('tPrice')};
  if (!body.name) return toast('Nhập tên topping', true);
  await api(id ? `/api/admin/toppings/${id}` : '/api/admin/toppings', {
    method:id ? 'PUT' : 'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  closeModal();
  await loadBase();
  state.settingsOpen.toppingSettings = true;
  renderSettings();
  toast(id ? 'Đã sửa topping' : 'Đã thêm topping');
}
async function deleteTop(id) {
  const t = state.toppings?.find(x => x.id === id);
  confirmDelete({
    title: 'Xóa topping?',
    message: 'Bạn có chắc muốn xóa topping',
    item: t?.name ? t.name + '?' : 'này?',
    onConfirm: async () => {
      await api('/api/admin/toppings/' + id,{method:'DELETE'});
      await loadBase();
      state.settingsOpen.toppingSettings = true;
      await renderSettings();
      toast('Đã xóa topping');
    }
  });
}
function renderBankPreview() {
  const el = $('#bankQrPreview'); if (!el) return;
  const url = buildVietQrUrl(100000, 'MINDSET DEMO');
  el.innerHTML = url ? `<div class="muted" style="margin-bottom:8px">Xem trước với 100.000đ</div><img class="qr-preview" src="${url}" alt="VietQR preview">` : '<div class="empty">Nhập đủ thông tin để xem trước VietQR</div>';
}

async function saveBankAccount(e) {
  e.preventDefault();
  const bankIdEl=$('#bankId'); const opt=bankIdEl?.selectedOptions?.[0];
  const body={ bankId:bankIdEl?.value||'', bankName:opt?.dataset?.name||opt?.textContent?.split(' · ')[0]||'', accountNo:$('#bankAccountNo')?.value||'', accountName:$('#bankAccountName')?.value||'', template:$('#bankTemplate')?.value||'compact2' };
  try {
    const d=await api('/api/admin/payment-bank',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    state.bankAccount=d.bank;

    if (state.user?.role === 'admin') {
      const clientId=$('#payosClientId')?.value.trim() || '';
      const apiKey=$('#payosApiKey')?.value.trim() || '';
      const checksumKey=$('#payosChecksumKey')?.value.trim() || '';
      const hasNewKeys=clientId || apiKey || checksumKey || !state.payosConfig.configured;
      if (hasNewKeys) {
        const pc=await api('/api/admin/payos-credentials',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,apiKey,checksumKey})});
        state.payosConfig={configured:true,source:'database',clientId:pc.clientId,apiKeyMasked:apiKey ? `••••${apiKey.slice(-4)}` : state.payosConfig.apiKeyMasked,checksumKeyMasked:checksumKey ? `••••${checksumKey.slice(-4)}` : state.payosConfig.checksumKeyMasked};
        toast('Đã lưu tài khoản ngân hàng và chuyển sang kênh payOS mới');
      } else {
        toast('Đã lưu tài khoản ngân hàng');
      }
    } else {
      toast('Đã lưu tài khoản ngân hàng');
    }
    state.settingsOpen.bankSettings=true;
    renderSettings();
  } catch(e){ toast(e.message,true); }
}

async function uploadQR(){ toast('QR tĩnh đã được thay bằng VietQR tự động', true); }

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
function closeModal() {
  $('#modal').classList.add('hidden');
  window.__productDraft = null;
  window.__editIndex = null;
}
window.closeModal = closeModal;

// Với modal tìm khách: bấm ra vùng nền ngoài modal cũng ghi nhận khách đang xem.
document.addEventListener('click', (e) => {
  const modal = $('#modal');
  if (!modal || modal.classList.contains('hidden')) return;
  if (e.target === modal && state.pendingCustomerSelection) {
    closeCustomerPicker();
  }
});

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
  localStorage.removeItem('mindset_auth_token');
  localStorage.removeItem('mindset_auth_user');
  await exitAppFullscreen();
  location.reload();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  const form = e.currentTarget;
  const submitBtn = form.querySelector('button[type="submit"]');
  const oldText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang vào...';
  submitBtn.classList.add('login-loading');

  // Gọi ngay trong thao tác click/submit của người dùng để trình duyệt
  // cho phép vào fullscreen. Nếu đăng nhập thất bại, thoát fullscreen lại.
  const fullscreenStarted = await enterAppFullscreen();

  try {
    const loginResult = await api('/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        username:$('#loginUser').value,
        password:$('#loginPass').value
      })
    });

    // Lưu JWT làm phương án dự phòng cho cookie. Khi F5, api() sẽ gửi token này
    // qua Authorization nên phiên đăng nhập không bị mất.
    if (loginResult.token) {
      localStorage.setItem('mindset_auth_token', loginResult.token);
    }
    if (loginResult.user) {
      localStorage.setItem('mindset_auth_user', JSON.stringify(loginResult.user));
    }

    // Chỉ sau khi đăng nhập thành công mới chạy transition sang POS.
    await boot({ animate:true });
  } catch(e) {
    if (fullscreenStarted) await exitAppFullscreen();
    submitBtn.disabled = false;
    submitBtn.textContent = oldText;
    submitBtn.classList.remove('login-loading');
    toast(e.message,true);
  }
});
$('#togglePass').onclick = () => { const i=$('#loginPass'); i.type=i.type==='password'?'text':'password'; $('#togglePass').textContent=i.type==='password'?'Hiện':'Ẩn'; };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleString('vi-VN',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});} setInterval(tick,1000); tick();

Object.assign(window,{go,logout,setCat,filterMenu,openProduct,addConfiguredProduct,changeQty,removeCart,clearCart,editCartItem,adjustTopModal,saveCartItem,selectPayment,checkout,completePayment,openCashPaymentModal,renderCashPaymentModal,changeCashDenomination,confirmCashPayment,openCustomerLoyaltyModal,searchCustomerForCheckout,skipCustomerAndContinue,chooseCustomerOption,showCreateCustomerForm,createCustomerAndContinue,closeCustomerPicker,printOrder,userForm,saveUser,deleteUser,menuForm,saveMenu,deleteMenu,categoryForm,deleteCategory,toppingForm,saveTop,deleteTop,uploadQR,toggleSettingsSection,loadReport,confirmDelete,closeConfirmDelete,runConfirmDelete});
boot();
