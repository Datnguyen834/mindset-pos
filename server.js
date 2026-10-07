import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { PayOS } from '@payos/node';
import QRCode from 'qrcode';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

const publicBaseUrl = () => String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const payosSecretKey = crypto.createHash('sha256').update(String(JWT_SECRET)).digest();

function encryptPayOSConfig(config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', payosSecretKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({v:1,iv:iv.toString('base64'),tag:tag.toString('base64'),data:encrypted.toString('base64')});
}
function decryptPayOSConfig(value) {
  try {
    const raw = JSON.parse(String(value || ''));
    if (!raw?.iv || !raw?.tag || !raw?.data) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', payosSecretKey, Buffer.from(raw.iv,'base64'));
    decipher.setAuthTag(Buffer.from(raw.tag,'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(raw.data,'base64')), decipher.final()]).toString('utf8');
    const cfg = JSON.parse(plain);
    if (!cfg.clientId || !cfg.apiKey || !cfg.checksumKey) return null;
    return cfg;
  } catch { return null; }
}
async function getPayOSConfig() {
  const r = await q("SELECT value FROM settings WHERE key='payos_credentials'");
  const dbConfig = decryptPayOSConfig(r.rows[0]?.value);
  if (dbConfig) return {...dbConfig, source:'database'};
  const envConfig = {
    clientId: String(process.env.PAYOS_CLIENT_ID || '').trim(),
    apiKey: String(process.env.PAYOS_API_KEY || '').trim(),
    checksumKey: String(process.env.PAYOS_CHECKSUM_KEY || '').trim(),
    source: 'environment'
  };
  return envConfig.clientId && envConfig.apiKey && envConfig.checksumKey ? envConfig : null;
}
function makePayOS(config) {
  if (!config?.clientId || !config?.apiKey || !config?.checksumKey) return null;
  return new PayOS({clientId:config.clientId,apiKey:config.apiKey,checksumKey:config.checksumKey});
}

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const q = (text, params=[]) => pool.query(text, params);

// Product images are stored in Neon, not Git. The local menu folder is used only
// for a one-time migration of the images shipped with older builds.
const MENU_IMAGE_DIR = path.join(__dirname, 'public/assets/menu');

function mimeTypeFromFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ({
    '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp',
    '.gif':'image/gif','.svg':'image/svg+xml','.avif':'image/avif'
  })[ext] || 'application/octet-stream';
}

function imageResponsePath(id, updatedAt) {
  const version = updatedAt ? encodeURIComponent(new Date(updatedAt).getTime()) : Date.now();
  return `/api/menu/${id}/image?v=${version}`;
}

async function migrateLocalImagesToNeon() {
  if (!fs.existsSync(MENU_IMAGE_DIR)) return;
  const files = fs.readdirSync(MENU_IMAGE_DIR).filter(name => !name.endsWith('.json'));
  if (!files.length) return;

  const rows = await q(`SELECT id,name,image_path FROM menu_items WHERE image_blob IS NULL AND image_path IS NOT NULL`);
  let migrated = 0;
  for (const item of rows.rows) {
    const imagePath = String(item.image_path || '');
    const filename = path.basename(imagePath);
    const file = path.join(MENU_IMAGE_DIR, filename);
    if (!filename || !fs.existsSync(file)) continue;
    try {
      const buffer = fs.readFileSync(file);
      await q(`UPDATE menu_items
               SET image_blob=$1,image_mime=$2,image_path=NULL,updated_at=NOW()
               WHERE id=$3`, [buffer, mimeTypeFromFilename(filename), item.id]);
      migrated++;
    } catch (e) {
      console.error(`Image migration failed for ${item.name}:`, e?.message || e);
    }
  }
  if (migrated) console.log(`Migrated ${migrated} product image(s) from the old local/Git folder into Neon.`);
}

function imagePathForName(name) {
  const aliases = new Map([
    ['Cà phê đen','ca-phe-den.jpg'],['Cà phê sữa','ca-phe-sua.jpg'],['Americano','americano.jpg'],['Latte','latte.jpg'],['Cappuccino','cappuccino.jpg'],
    ['Cold Brew','cold-brew.jpg'],['Bạc xỉu','bac-xiu.jpg'],['Matcha Latte','matcha-latte.jpg'],['Trà đào','tra-dao.jpg'],['Trà vải','tra-vai.jpg'],['Trà ô long','tra-o-long.jpg'],['Trà lài','tra-lai.jpg'],
    ['Chocolate','chocolate.jpg'],['Đá xay socola','da-xay-socola.jpg'],['Đá xay matcha','da-xay-matcha.jpg'],
    ['Tiramisu','tiramisu.svg'],['Cheesecake','cheesecake.svg'],['Croissant','croissant.svg'],['Su kem','su-kem.svg'],['Red Velvet','red-velvet.svg'],['Cookie chocolate','cookie.svg'],
    ['Bánh cheesecake','cheesecake.svg'],['Bánh red velvet','red-velvet.svg'],['Bánh chocolate','chocolate.jpg'],['Bánh matcha','matcha-latte.jpg'],
    ['Croissant chocolate','croissant.svg'],['Cookie chocolate chip','cookie.svg'],['Brownie','brownie.png']
  ]);
  const exact=aliases.get(String(name||''));
  if(exact && fs.existsSync(path.join(MENU_IMAGE_DIR,exact))) return imagePathFromFile(exact);
  const files=fs.existsSync(MENU_IMAGE_DIR)?fs.readdirSync(MENU_IMAGE_DIR):[];
  const slug=slugifyFileName(name);
  const hit=files.find(f=>slugifyFileName(path.parse(f).name)===slug || slugifyFileName(path.parse(f).name).includes(slug) || slug.includes(slugifyFileName(path.parse(f).name)));
  return hit ? imagePathFromFile(hit) : null;
}

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await q(schema);
  await q(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_path TEXT`);
  await q(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_blob BYTEA`);
  await q(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_mime TEXT`);
  const count = await q('SELECT COUNT(*)::int AS n FROM users');
  if (count.rows[0].n === 0) {
    const a = await bcrypt.hash('admin@123', 10);
    const s = await bcrypt.hash('123456@', 10);
    await q(`INSERT INTO users(username,password_hash,full_name,role) VALUES ($1,$2,$3,'admin'),($4,$5,$6,'staff')`, ['admin',a,'Quản trị viên','nhanvien',s,'Đạt']);
  }
  const existingPayOS = await q("SELECT 1 FROM settings WHERE key='payos_credentials' LIMIT 1");
  if (!existingPayOS.rowCount && process.env.PAYOS_CLIENT_ID && process.env.PAYOS_API_KEY && process.env.PAYOS_CHECKSUM_KEY) {
    await q("INSERT INTO settings(key,value) VALUES('payos_credentials',$1)", [encryptPayOSConfig({clientId:String(process.env.PAYOS_CLIENT_ID).trim(),apiKey:String(process.env.PAYOS_API_KEY).trim(),checksumKey:String(process.env.PAYOS_CHECKSUM_KEY).trim()})]);
  }
  // Quyền tài khoản: admin = admin tổng (tài khoản hệ thống), manager = quản lý, staff = nhân viên.
  // Migration cho database cũ: đổi constraint role và chuyển các tài khoản admin không phải 'admin' thành manager.
  try {
    await q(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await q(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','manager','staff'))`);
  } catch {}
  await q(`UPDATE users SET role='manager' WHERE role='admin' AND username <> 'admin'`);
  await q(`UPDATE member_rewards SET reward_quantity=2, remaining_quantity=CASE WHEN redeemed_at IS NOT NULL THEN 0 ELSE 2 END WHERE tier_key='gold' AND reward_quantity=1 AND remaining_quantity<=1`);
  await q(`UPDATE member_rewards SET remaining_quantity = 0 WHERE redeemed_at IS NOT NULL`);

  const menuCount = await q('SELECT COUNT(*)::int AS n FROM menu_items');
  const freshMenuDatabase = Number(menuCount.rows[0].n) === 0;
  if (freshMenuDatabase) {
    const items = [
      ['Cà phê đen','Cà phê',25000,'ca-phe-den.jpg'],['Cà phê sữa','Cà phê',28000,'ca-phe-sua.jpg'],['Americano','Cà phê',25000,'americano.jpg'],['Latte','Cà phê',35000,'latte.jpg'],['Cappuccino','Cà phê',35000,'cappuccino.jpg'],
      ['Cold Brew','Cà phê',35000,'cold-brew.jpg'],['Bạc xỉu','Cà phê',32000,'bac-xiu.jpg'],['Matcha Latte','Trà',40000,'matcha-latte.jpg'],['Trà đào','Trà',35000,'tra-dao.jpg'],['Trà vải','Trà',35000,'tra-vai.jpg'],
      ['Trà ô long','Trà',30000,'tra-o-long.jpg'],['Trà lài','Trà',30000,'tra-lai.jpg'],['Chocolate','Khác',35000,'chocolate.jpg'],['Đá xay socola','Đá xay',45000,'da-xay-socola.jpg'],['Đá xay matcha','Đá xay',45000,'da-xay-matcha.jpg']
    ];
    for (const [name,cat,price,file] of items) {
      const imagePath = fs.existsSync(path.join(MENU_IMAGE_DIR,file)) ? imagePathFromFile(file) : null;
      await q('INSERT INTO menu_items(name,category,price,image_path,image_data) VALUES($1,$2,$3,$4,NULL)',[name,cat,price,imagePath]);
    }
  }
  // Seed bakery only when the database is brand new. Never recreate a product
  // that an admin deleted later. Neon is the source of truth after first seed.
  if (freshMenuDatabase) {
    await q(`INSERT INTO categories(name) VALUES('Bánh ngọt') ON CONFLICT(name) DO NOTHING`);
    const bakeryItems = [
      ['Tiramisu','Bánh ngọt',45000,'tiramisu.svg'],
      ['Cheesecake','Bánh ngọt',45000,'cheesecake.svg'],
      ['Croissant','Bánh ngọt',30000,'croissant.svg'],
      ['Su kem','Bánh ngọt',28000,'su-kem.svg'],
      ['Red Velvet','Bánh ngọt',42000,'red-velvet.svg'],
      ['Cookie chocolate','Bánh ngọt',22000,'cookie.svg']
    ];
    for (const [name,cat,price,file] of bakeryItems) {
      const imagePath = fs.existsSync(path.join(MENU_IMAGE_DIR,file)) ? imagePathFromFile(file) : null;
      await q('INSERT INTO menu_items(name,category,price,image_path,image_data) VALUES($1,$2,$3,$4,NULL)',[name,cat,price,imagePath]);
    }
  }
  await q(`INSERT INTO categories(name) SELECT DISTINCT category FROM menu_items WHERE category IS NOT NULL AND TRIM(category) <> '' ON CONFLICT(name) DO NOTHING`);
  const topCount = await q('SELECT COUNT(*)::int AS n FROM toppings');
  if (topCount.rows[0].n === 0) {
    await q(`INSERT INTO toppings(name,price) VALUES ('Trân châu',5000),('Thạch',5000),('Kem cheese',8000),('Shot espresso',10000),('Sữa tươi',5000)`);
  }
  // Remove retired categories/products: Sinh tố and Nước ép.
  // Historical order_items are preserved; referenced products are only deactivated.
  await q(`
    UPDATE menu_items
    SET active=FALSE, updated_at=NOW()
    WHERE LOWER(TRIM(category)) IN ('sinh tố','nước ép')
  `);
  await q(`
    DELETE FROM menu_items m
    WHERE LOWER(TRIM(m.category)) IN ('sinh tố','nước ép')
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi WHERE oi.menu_item_id = m.id
      )
  `);
  await q(`
    DELETE FROM categories
    WHERE LOWER(TRIM(name)) IN ('sinh tố','nước ép')
  `);
  // IMPORTANT: do not synchronize a hard-coded full menu on every startup.
  // Neon is the source of truth after the initial seed. Re-inserting/updating
  // this list would resurrect products that an admin intentionally deleted.

  // One-time migration: move images from the old Git/local folder into Neon.
  // Also migrate legacy base64 text images from older database versions.
  // After this succeeds, product CRUD never touches Git again.
  await migrateLocalImagesToNeon();
  const legacyBase64 = await q(`SELECT id,image_data FROM menu_items WHERE image_blob IS NULL AND image_data IS NOT NULL AND TRIM(image_data) <> ''`);
  for (const item of legacyBase64.rows) {
    try {
      const raw = String(item.image_data || '');
      const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
      const mime = match?.[1] || 'image/jpeg';
      const encoded = match?.[2] || raw;
      const buffer = Buffer.from(encoded.replace(/\s/g,''), 'base64');
      if (buffer.length) await q('UPDATE menu_items SET image_blob=$1,image_mime=$2,image_data=NULL,image_path=NULL,updated_at=NOW() WHERE id=$3',[buffer,mime,item.id]);
    } catch (e) {
      console.error(`Legacy database image migration failed for menu ${item.id}:`, e?.message || e);
    }
  }
  await q(`INSERT INTO settings(key,value) VALUES('discount_rules','[]') ON CONFLICT(key) DO NOTHING`);
}

function sign(user) { return jwt.sign({ id:user.id, username:user.username, fullName:user.full_name, role:user.role }, JWT_SECRET, { expiresIn:'30d' }); }
function auth(req,res,next) {
  try {
    // Ưu tiên cookie HttpOnly; Authorization là phương án dự phòng để F5
    // không làm mất phiên nếu trình duyệt/hosting không gửi lại cookie.
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const token = bearer || req.cookies.mindset_token;
    if (!token) return res.status(401).json({message:'Chưa đăng nhập'});
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({message:'Phiên đăng nhập đã hết hạn'}); }
}
function adminOnly(req,res,next){ if(!['admin','manager'].includes(req.user.role)) return res.status(403).json({message:'Chỉ quản lý hoặc admin tổng được phép'}); next(); }
function payOSAdminOnly(req,res,next){ if(req.user.role!=='admin') return res.status(403).json({message:'Chỉ Admin tổng được phép thay đổi kênh thanh toán'}); next(); }
function money(n){ return Math.round(Number(n)||0); }

app.get('/api/health', async (_,res)=>{ try { await q('SELECT 1'); res.json({ok:true}); } catch(e){ res.status(500).json({ok:false}); }});

app.post('/api/auth/login', async (req,res)=>{
  const {username,password}=req.body;
  const r=await q('SELECT * FROM users WHERE username=$1 AND active=true',[username]);
  if(!r.rowCount || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({message:'Sai tài khoản hoặc mật khẩu'});
  const u=r.rows[0];
  const token = sign(u);
  res.cookie('mindset_token',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:30*24*60*60*1000});
  // Trả token thêm cho client để có phương án dự phòng khi reload.
  res.json({token,user:{id:u.id,username:u.username,fullName:u.full_name,role:u.role}});
});
app.post('/api/auth/logout',(req,res)=>{
  res.clearCookie('mindset_token',{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'});
  res.json({ok:true});
});

// Gia hạn phiên khi người dùng F5 sau một thời gian dài. Chỉ chấp nhận JWT
// được ký bằng đúng JWT_SECRET của server; token hết hạn vẫn phải có chữ ký hợp lệ.
app.post('/api/auth/refresh',async(req,res)=>{
  try {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const token = bearer || req.cookies.mindset_token;
    if (!token) return res.status(401).json({message:'Chưa đăng nhập'});
    const payload = jwt.verify(token, JWT_SECRET, {ignoreExpiration:true});
    const r = await q('SELECT id,username,full_name,role,active FROM users WHERE id=$1',[payload.id]);
    if (!r.rowCount || !r.rows[0].active) return res.status(401).json({message:'Tài khoản không còn hoạt động'});
    const u = r.rows[0];
    const newToken = sign(u);
    res.cookie('mindset_token',newToken,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:30*24*60*60*1000});
    res.json({token:newToken,user:{id:u.id,username:u.username,fullName:u.full_name,role:u.role}});
  } catch {
    res.status(401).json({message:'Không thể khôi phục phiên đăng nhập'});
  }
});

app.get('/api/auth/me',auth,async(req,res)=>{
  // Đọc lại user từ DB để role/trạng thái thay đổi có hiệu lực ngay cả khi JWT cũ còn hạn.
  const r = await q('SELECT id,username,full_name,role,active FROM users WHERE id=$1',[req.user.id]);
  if (!r.rowCount || !r.rows[0].active) return res.status(401).json({message:'Tài khoản không còn hoạt động'});
  const u = r.rows[0];
  res.json({user:{id:u.id,username:u.username,fullName:u.full_name,role:u.role}});
});

app.get('/api/menu',auth,async(req,res)=>{
  const r=await q(`SELECT id,name,category,price,
    CASE WHEN image_blob IS NOT NULL THEN '/api/menu/' || id || '/image?v=' || EXTRACT(EPOCH FROM updated_at)::bigint
         ELSE image_path END AS image,
    active
    FROM menu_items WHERE active=true ORDER BY id`);
  res.json(r.rows);
});

app.get('/api/menu/:id/image',auth,async(req,res)=>{
  const r=await q('SELECT image_blob,image_mime FROM menu_items WHERE id=$1 AND active=true',[req.params.id]);
  if(!r.rowCount || !r.rows[0].image_blob) return res.status(404).end();
  res.set('Content-Type', r.rows[0].image_mime || 'application/octet-stream');
  // Versioned URL changes whenever an image changes, so the browser can cache
  // aggressively without ever showing the previous image after an update.
  res.set('Cache-Control','private, max-age=31536000, immutable');
  res.end(r.rows[0].image_blob);
});
app.get('/api/categories',auth,async(req,res)=>{ const r=await q('SELECT id,name FROM categories WHERE active=true ORDER BY id'); res.json(r.rows); });
app.get('/api/toppings',auth,async(req,res)=>{ const r=await q('SELECT id,name,price FROM toppings WHERE active=true ORDER BY id'); res.json(r.rows); });
app.get('/api/settings/payos',auth,payOSAdminOnly,async(req,res)=>{ const cfg=await getPayOSConfig(); if(!cfg) return res.json({configured:false,source:null,clientId:''}); const mask=(v)=>v ? `••••${String(v).slice(-4)}` : ''; res.json({configured:true,source:cfg.source,clientId:cfg.clientId||'',apiKeyMasked:mask(cfg.apiKey),checksumKeyMasked:mask(cfg.checksumKey)}); });
app.get('/api/settings/discount-rules',auth,async(req,res)=>{ const r=await q("SELECT value FROM settings WHERE key='discount_rules'"); let rules=[]; try{ rules=JSON.parse(r.rows[0]?.value||'[]'); }catch{} res.json({rules:Array.isArray(rules)?rules:[]}); });


const POINT_EARN_VALUE = 20000;
const POINT_DISCOUNT_VALUE = 1000;
const MEMBER_TIERS = [
  { key:'diamond', name:'Kim cương', threshold:5000000, reward:'Gấu bông to' },
  { key:'platinum', name:'Bạch kim', threshold:2000000, reward:'Gấu bông nhỏ' },
  { key:'gold', name:'Vàng', threshold:1000000, reward:'2 ly nước free' },
  { key:'silver', name:'Bạc', threshold:500000, reward:'1 ly nước free' },
];
function memberTierForSpend(totalSpend){ return MEMBER_TIERS.find(t => Number(totalSpend||0) >= t.threshold) || null; }
function memberRewardQuantity(tierKey){ return tierKey === 'gold' ? 2 : 1; }
function memberRewardIsDrink(tierKey){ return tierKey === 'silver' || tierKey === 'gold'; }
async function syncMemberCoupon(customerId, totalSpend, db = pool) {
  const tier = memberTierForSpend(totalSpend);
  if (!tier) return null;
  const year = new Date().getFullYear();
  const client = db === pool ? null : db;
  const run = async (sql, params) => client ? client.query(sql, params) : q(sql, params);
  const existing = await run('SELECT id,tier_key,tier_name,reward_name,reward_quantity,remaining_quantity,redeemed_at,earned_year FROM member_rewards WHERE customer_id=$1 AND earned_year=$2 ORDER BY id DESC LIMIT 1',[customerId,year]);
  if (!existing.rowCount) {
    const r = await run('INSERT INTO member_rewards(customer_id,earned_year,tier_key,tier_name,reward_name,reward_quantity,remaining_quantity) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id,tier_key AS "tierKey",tier_name AS "tierName",reward_name AS "rewardName",reward_quantity AS "rewardQuantity",remaining_quantity AS "remainingQuantity",redeemed_at AS "redeemedAt"',[customerId,year,tier.key,tier.name,tier.reward,memberRewardQuantity(tier.key)]);
    return r.rows[0];
  }
  const current = existing.rows[0];
  const rank = {silver:1,gold:2,platinum:3,diamond:4};
  if ((rank[tier.key]||0) > (rank[current.tier_key]||0)) {
    const r = await run('UPDATE member_rewards SET tier_key=$1,tier_name=$2,reward_name=$3,reward_quantity=$4,remaining_quantity=$4,redeemed_at=NULL,redeemed_by=NULL,updated_at=NOW() WHERE id=$5 RETURNING id,tier_key AS "tierKey",tier_name AS "tierName",reward_name AS "rewardName",reward_quantity AS "rewardQuantity",remaining_quantity AS "remainingQuantity",redeemed_at AS "redeemedAt"',[tier.key,tier.name,tier.reward,memberRewardQuantity(tier.key),current.id]);
    return r.rows[0];
  }
  return {id:current.id,tierKey:current.tier_key,tierName:current.tier_name,rewardName:current.reward_name,rewardQuantity:Number(current.reward_quantity||1),remainingQuantity:Number(current.remaining_quantity||0),redeemedAt:current.redeemed_at};
}
function normalizePhone(value) { return String(value || '').replace(/\D/g, '').slice(0, 15); }

app.get('/api/customers/search', auth, async (req,res)=>{
  const phone = normalizePhone(req.query.phone);
  if (!phone) return res.status(400).json({message:'Nhập số điện thoại'});
  const r = await q(`SELECT c.id,c.phone,c.full_name AS "fullName",c.birth_date AS "birthDate",c.points,COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.customer_id=c.id AND o.status='paid' AND o.created_at >= date_trunc('year', NOW())),0)::int AS "totalSpend" FROM customers c WHERE c.phone=$1 LIMIT 1`,[phone]);
  if (!r.rowCount) return res.json({customer:null});
  const c = r.rows[0];
  const coupon = await syncMemberCoupon(c.id, c.totalSpend);
  const tier = memberTierForSpend(c.totalSpend);
  res.json({customer:{...c,tier:tier?.key||null,tierName:tier?.name||'Chưa có hạng',coupon}});
});

app.post('/api/customers', auth, async (req,res)=>{
  const phone = normalizePhone(req.body.phone);
  const fullName = String(req.body.fullName || '').trim();
  const birthDate = String(req.body.birthDate || '').trim();
  if (!phone || phone.length < 9) return res.status(400).json({message:'Số điện thoại không hợp lệ'});
  if (!fullName) return res.status(400).json({message:'Nhập họ tên khách hàng'});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({message:'Vui lòng nhập ngày tháng năm sinh'});
  try {
    const r = await q('INSERT INTO customers(phone,full_name,birth_date) VALUES($1,$2,$3) RETURNING id,phone,full_name AS "fullName",birth_date AS "birthDate",points',[phone,fullName,birthDate]);
    res.json({customer:{...r.rows[0],totalSpend:0}});
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({message:'Số điện thoại này đã có tài khoản'});
    res.status(400).json({message:'Không tạo được tài khoản khách hàng'});
  }
});

app.get('/api/admin/members/search', auth, adminOnly, async (req,res)=>{
  const phone = normalizePhone(req.query.phone);
  if (!phone) return res.status(400).json({message:'Nhập số điện thoại thành viên'});
  const r = await q(`SELECT c.id,c.phone,c.full_name AS "fullName",c.birth_date AS "birthDate",c.points,COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.customer_id=c.id AND o.status='paid' AND o.created_at >= date_trunc('year', NOW())),0)::int AS "totalSpend",c.created_at AS "createdAt" FROM customers c WHERE c.phone=$1 LIMIT 1`,[phone]);
  if (!r.rowCount) return res.json({member:null});
  const m = r.rows[0];
  const coupon = await syncMemberCoupon(m.id, m.totalSpend);
  const tier = memberTierForSpend(m.totalSpend);
  res.json({member:{...m,tier:tier?.key||null,tierName:tier?.name||'Chưa có hạng',coupon}});
});

app.put('/api/admin/members/:id', auth, adminOnly, async (req,res)=>{
  const fullName = String(req.body.fullName || '').trim();
  const birthDate = String(req.body.birthDate || '').trim();
  if (!fullName) return res.status(400).json({message:'Nhập họ tên thành viên'});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({message:'Ngày tháng năm sinh không hợp lệ'});
  const r = await q('UPDATE customers SET full_name=$1,birth_date=$2,updated_at=NOW() WHERE id=$3 RETURNING id,phone,full_name AS "fullName",birth_date AS "birthDate",points',[fullName,birthDate,req.params.id]);
  if (!r.rowCount) return res.status(404).json({message:'Không tìm thấy thành viên'});
  res.json({member:r.rows[0]});
});

app.post('/api/customers/:id/reward/use', auth, async (req,res)=>{
  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) return res.status(400).json({message:'Thành viên không hợp lệ'});
  const year = new Date().getFullYear();
  const r = await q(`UPDATE member_rewards SET remaining_quantity=0,redeemed_at=NOW(),redeemed_by=$1,updated_at=NOW() WHERE id=(SELECT id FROM member_rewards WHERE customer_id=$2 AND earned_year=$3 AND remaining_quantity>0 AND tier_key IN ('platinum','diamond') ORDER BY id DESC LIMIT 1) RETURNING id,tier_key AS "tierKey",tier_name AS "tierName",reward_name AS "rewardName",reward_quantity AS "rewardQuantity",remaining_quantity AS "remainingQuantity",redeemed_at AS "redeemedAt"`,[req.user.id,customerId,year]);
  if (!r.rowCount) return res.status(400).json({message:'Coupon hiện không thể sử dụng tại đây'});
  res.json({reward:r.rows[0]});
});

app.post('/api/orders',auth,async(req,res)=>{
  const {items,paymentMethod,customerId=null,redeemPoints=false,memberRewardId=null,memberRewardQuantity=0}=req.body;
  if(!Array.isArray(items)||!items.length) return res.status(400).json({message:'Giỏ hàng trống'});
  if(!['cash','transfer'].includes(paymentMethod)) return res.status(400).json({message:'Phương thức thanh toán không hợp lệ'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const shiftId = null;
    let subtotal=0;
    const normalized=[];
    for(const item of items){
      const mi=await client.query('SELECT id,name,price FROM menu_items WHERE id=$1 AND active=true',[item.menuItemId]);
      if(!mi.rowCount) throw new Error('Món không tồn tại');
      const m=mi.rows[0]; const qty=Math.max(1,Number(item.quantity)||1);
      let topTotal=0; const tops=[];
      for(const t of (item.toppings||[])){
        const tr=await client.query('SELECT id,name,price FROM toppings WHERE id=$1 AND active=true',[t.id]);
        if(tr.rowCount){ const tq=Math.max(1,Number(t.quantity)||1); topTotal += Number(tr.rows[0].price)*tq; tops.push({...tr.rows[0],quantity:tq}); }
      }
      const line=(Number(m.price)+topTotal)*qty; subtotal+=line; normalized.push({m,qty,tops,line,sugarPercent:Math.min(100,Math.max(0,money(item.sugarPercent ?? 100))),icePercent:Math.min(100,Math.max(0,money(item.icePercent ?? 100)))});
    }

    // Discount tự động theo cấu hình Admin.
    const setting=await client.query("SELECT value FROM settings WHERE key='discount_rules'");
    let rules=[];
    try{ rules=JSON.parse(setting.rows[0]?.value||'[]'); }catch{}
    rules=Array.isArray(rules)?rules.map(r=>({threshold:money(r.threshold),percent:Math.min(100,Math.max(0,money(r.percent)))})).filter(r=>r.threshold>0&&r.percent>0):[];
    rules.sort((a,b)=>b.threshold-a.threshold);
    const matchedRule=rules.find(r=>subtotal>=r.threshold);
    const discountPercent=matchedRule?.percent||0;
    const automaticDiscount=Math.min(subtotal,Math.round(subtotal*discountPercent/100));
    const afterAutomatic=Math.max(0,subtotal-automaticDiscount);

    // Tích điểm khách hàng: mua 20.000đ = 1 điểm; 1 điểm giảm 1.000đ.
    // Nếu khách chọn trừ điểm, chỉ dùng số điểm cần thiết để không làm tổng hóa đơn âm.
    let customer = null;
    let pointsUsed = 0;
    let pointsEarned = 0;
    let pointsDiscount = 0;
    if(customerId){
      const cr=await client.query('SELECT id,phone,full_name AS "fullName",birth_date AS "birthDate",points FROM customers WHERE id=$1 FOR UPDATE',[customerId]);
      if(!cr.rowCount) throw new Error('Không tìm thấy tài khoản khách hàng');
      customer=cr.rows[0];
      if(redeemPoints){
        pointsUsed=Math.min(Number(customer.points)||0, Math.floor(afterAutomatic/POINT_DISCOUNT_VALUE));
        pointsDiscount=pointsUsed*POINT_DISCOUNT_VALUE;
      }
    }

    let memberCouponQty = 0;
    let memberCouponDiscount = 0;
    let memberReward = null;
    const requestedCouponQty = Math.max(0, Number(memberRewardQuantity)||0);
    if (requestedCouponQty > 0) {
      if (!customer) throw new Error('Vui lòng chọn khách hàng để sử dụng coupon');
      const rr = await client.query('SELECT id,customer_id,tier_key,tier_name,reward_name,reward_quantity,remaining_quantity FROM member_rewards WHERE id=$1 AND customer_id=$2 AND earned_year=$3 FOR UPDATE',[Number(memberRewardId),customer.id,new Date().getFullYear()]);
      if (!rr.rowCount) throw new Error('Coupon không hợp lệ');
      memberReward = rr.rows[0];
      if (!memberRewardIsDrink(memberReward.tier_key)) throw new Error('Coupon này là quà nhận trực tiếp, không dùng để trừ tiền đồ uống');
      const eligibleDrinkQty = normalized.reduce((sum,x)=>sum + (String(x.m.category||'').trim() === 'Bánh ngọt' ? 0 : x.qty),0);
      memberCouponQty = Math.min(requestedCouponQty, Number(memberReward.remaining_quantity||0), eligibleDrinkQty);
      if (memberCouponQty <= 0) throw new Error('Hóa đơn chưa có đồ uống để sử dụng coupon');
      let left = memberCouponQty;
      // Coupon miễn phí ly nước: ưu tiên trừ các ly có giá thấp trước; topping đi cùng ly cũng được miễn.
      const drinkLines = [...normalized].filter(x=>String(x.m.category||'').trim() !== 'Bánh ngọt').sort((a,b)=>Number(a.line/a.qty)-Number(b.line/b.qty));
      for (const x of drinkLines) {
        if (left <= 0) break;
        const take = Math.min(left, x.qty);
        const unitLine = Math.round(Number(x.line)/Math.max(1,x.qty));
        memberCouponDiscount += unitLine * take;
        left -= take;
      }
      const newRemaining = Number(memberReward.remaining_quantity||0) - memberCouponQty;
      await client.query(`UPDATE member_rewards SET remaining_quantity=$1,redeemed_at=CASE WHEN $1=0 THEN NOW() ELSE NULL END,redeemed_by=CASE WHEN $1=0 THEN $2 ELSE redeemed_by END,updated_at=NOW() WHERE id=$3`,[newRemaining,req.user.id,memberReward.id]);
    }

    const total=Math.max(0,afterAutomatic-pointsDiscount-memberCouponDiscount);
    if(customer && !redeemPoints){
      pointsEarned=Math.floor(total/POINT_EARN_VALUE);
    }

    // Tiền mặt được hoàn tất ngay. Chuyển khoản phải chờ payOS xác nhận webhook.
    const initialStatus = (paymentMethod === 'transfer' && total > 0) ? 'pending' : 'paid';
    const order=await client.query(`INSERT INTO orders(user_id,shift_id,customer_id,payment_method,subtotal,discount,automatic_discount,points_discount,points_used,points_earned,member_reward_id,member_reward_quantity,member_reward_discount,total,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[req.user.id,shiftId,customer?.id || null,paymentMethod,subtotal,automaticDiscount+pointsDiscount+memberCouponDiscount,automaticDiscount,pointsDiscount,pointsUsed,pointsEarned,memberReward?.id || null,memberCouponQty,memberCouponDiscount,total,initialStatus]);
    for(const x of normalized){
      const oi=await client.query(`INSERT INTO order_items(order_id,menu_item_id,item_name,unit_price,quantity,line_total,sugar_percent,ice_percent) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[order.rows[0].id,x.m.id,x.m.name,x.m.price,x.qty,x.line,x.sugarPercent,x.icePercent]);
      for(const t of x.tops) await client.query(`INSERT INTO order_item_toppings(order_item_id,topping_id,topping_name,topping_price,quantity) VALUES($1,$2,$3,$4,$5)`,[oi.rows[0].id,t.id,t.name,t.price,t.quantity]);
    }

    if(customer && (paymentMethod === 'cash' || (paymentMethod === 'transfer' && total === 0))){
      const newPoints = Math.max(0, Number(customer.points||0) - pointsUsed + pointsEarned);
      await client.query('UPDATE customers SET points=$1,updated_at=NOW() WHERE id=$2',[newPoints,customer.id]);
      customer.points=newPoints;
      const spendNow = await client.query(`SELECT COALESCE(SUM(total),0)::int AS total FROM orders WHERE customer_id=$1 AND status='paid' AND created_at >= date_trunc('year', NOW())`,[customer.id]);
      await syncMemberCoupon(customer.id, Number(spendNow.rows[0]?.total||0), client);
    }

    await client.query('COMMIT');

    // Với chuyển khoản, có thể tạo payment ngay trong cùng request để giảm 1 round-trip
    // từ trình duyệt tới Render. Modal phía client được mở trước nên người dùng không phải
    // chờ trắng màn hình trong lúc payOS tạo payment link.
    if (paymentMethod === 'transfer' && req.body.createPayment === true) {
      try {
        const payosConfig = await getPayOSConfig();
        const payos = makePayOS(payosConfig);
        if (!payos) throw new Error('payOS chưa được cấu hình. Admin tổng hãy vào Cài đặt → Kênh thanh toán payOS để nhập bộ key mới.');
        const base = publicBaseUrl();
        const paymentLink = await payos.paymentRequests.create({
          orderCode: order.rows[0].id,
          amount: Number(total),
          description: 'Thanh toan CF Mindset',
          returnUrl: `${base}/?payos=success&orderCode=${order.rows[0].id}`,
          cancelUrl: `${base}/?payos=cancel&orderCode=${order.rows[0].id}`,
        });
        return res.json({
          orderId: order.rows[0].id,
          total,subtotal,discount:automaticDiscount+pointsDiscount+memberCouponDiscount,discountPercent,automaticDiscount,pointsDiscount,memberCouponDiscount,memberCouponQty,pointsUsed,pointsEarned,status:initialStatus,
          customer:customer?{id:customer.id,fullName:customer.fullName,birthDate:customer.birthDate,points:customer.points}:null,
          checkoutUrl: paymentLink.checkoutUrl || '',
          qrCode: paymentLink.qrCode || '',
          qrImage: paymentLink.qrCode ? await QRCode.toDataURL(paymentLink.qrCode, { width: 300, margin: 1, errorCorrectionLevel: 'M' }) : '',
          paymentLinkId: paymentLink.paymentLinkId || paymentLink.id || null,
        });
      } catch (payError) {
        console.error('payOS create payment error:', payError);
        await q(`UPDATE orders SET status='cancelled' WHERE id=$1 AND status='pending'`, [order.rows[0].id]);
        if (Number(order.rows[0].member_reward_quantity||0) > 0 && order.rows[0].member_reward_id) {
          await q(`UPDATE member_rewards SET remaining_quantity=remaining_quantity+$1,redeemed_at=NULL,updated_at=NOW() WHERE id=$2`, [Number(order.rows[0].member_reward_quantity||0), order.rows[0].member_reward_id]);
        }
        return res.status(502).json({message:payError?.message||'Không tạo được thanh toán payOS'});
      }
    }

    res.json({orderId:order.rows[0].id,total,subtotal,discount:automaticDiscount+pointsDiscount+memberCouponDiscount,discountPercent,automaticDiscount,pointsDiscount,memberCouponDiscount,memberCouponQty,pointsUsed,pointsEarned,status:initialStatus,customer:customer?{id:customer.id,fullName:customer.fullName,points:customer.points}:null});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({message:e.message||'Không tạo được đơn'});}finally{client.release();}
});

app.get('/api/admin/reports/recent-orders',auth,adminOnly,async(req,res)=>{
  const r=await q(`SELECT o.id,o.created_at,o.payment_method,o.total,u.full_name AS "fullName" FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 100`);
  res.json({orders:r.rows});
});

function localDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function reportBounds(from, to) {
  // PostgreSQL/Render thường chạy UTC. Gắn +07:00 để mọi báo cáo tính đúng ngày Việt Nam.
  const today = localDateString();
  return {
    start: `${from || today}T00:00:00+07:00`,
    end: `${to || today}T23:59:59.999+07:00`
  };
}

app.get('/api/admin/orders/staff',auth,adminOnly,async(req,res)=>{
  const {from,to}=req.query;
  const {start,end}=reportBounds(from,to);
  const r=await q(`SELECT u.id,u.full_name AS "fullName",
      COUNT(o.id)::int AS orders,
      COALESCE(SUM(o.total),0)::int AS revenue,
      COALESCE(SUM(CASE WHEN o.payment_method='cash' THEN o.total ELSE 0 END),0)::int AS cash,
      COALESCE(SUM(CASE WHEN o.payment_method='transfer' THEN o.total ELSE 0 END),0)::int AS transfer
    FROM users u
    LEFT JOIN orders o ON o.user_id=u.id AND o.status='paid' AND o.created_at BETWEEN $1 AND $2
    WHERE u.role IN ('staff','manager','admin')
    GROUP BY u.id,u.full_name ORDER BY u.full_name`,[start,end]);
  const total=await q(`SELECT COUNT(*)::int orders,COALESCE(SUM(total),0)::int revenue,
      COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0)::int cash,
      COALESCE(SUM(CASE WHEN payment_method='transfer' THEN total ELSE 0 END),0)::int transfer
    FROM orders WHERE status='paid' AND created_at BETWEEN $1 AND $2`,[start,end]);
  res.json({staff:r.rows,total:total.rows[0]});
});

app.get('/api/admin/orders/staff/:id',auth,adminOnly,async(req,res)=>{
  const {from,to,payment='',product=''}=req.query;
  const {start,end}=reportBounds(from,to);
  const staff=await q(`SELECT id,full_name AS "fullName" FROM users WHERE id=$1 AND role IN ('staff','manager','admin')`,[req.params.id]);
  if(!staff.rowCount) return res.status(404).json({message:'Không tìm thấy nhân viên'});
  const params=[req.params.id,start,end];
  const conditions=[`o.user_id=$1`,`o.status='paid'`,`o.created_at BETWEEN $2 AND $3`];
  if(payment){params.push(payment);conditions.push(`o.payment_method=$${params.length}`);}
  if(product){params.push(`%${product}%`);conditions.push(`EXISTS (SELECT 1 FROM order_items op WHERE op.order_id=o.id AND op.item_name ILIKE $${params.length})`);}
  const where=conditions.join(' AND ');
  const r=await q(`SELECT o.id,o.created_at,o.payment_method,o.total,
      COALESCE(STRING_AGG(DISTINCT oi.item_name,' · ' ORDER BY oi.item_name),'') AS products
    FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE ${where}
    GROUP BY o.id,o.created_at,o.payment_method,o.total
    ORDER BY o.created_at DESC,o.id DESC`,params);
  const sum=await q(`SELECT COUNT(*)::int orders,COALESCE(SUM(o.total),0)::int total,
      COALESCE(SUM(CASE WHEN o.payment_method='cash' THEN o.total ELSE 0 END),0)::int cash,
      COALESCE(SUM(CASE WHEN o.payment_method='transfer' THEN o.total ELSE 0 END),0)::int transfer
    FROM orders o WHERE ${where}`,params);
  res.json({staff:staff.rows[0],orders:r.rows,summary:sum.rows[0]});
});

app.get('/api/admin/orders/all',auth,adminOnly,async(req,res)=>{
  const {from,to,payment='',product='',staffId=''}=req.query;
  const {start,end}=reportBounds(from,to);
  const params=[start,end];
  const conditions=[`o.status='paid'`,`o.created_at BETWEEN $1 AND $2`];
  if(payment){params.push(payment);conditions.push(`o.payment_method=$${params.length}`);}
  if(product){params.push(`%${product}%`);conditions.push(`EXISTS (SELECT 1 FROM order_items op WHERE op.order_id=o.id AND op.item_name ILIKE $${params.length})`);}
  if(staffId){params.push(Number(staffId));conditions.push(`o.user_id=$${params.length}`);}
  const where=conditions.join(' AND ');
  const r=await q(`SELECT o.id,o.created_at,o.payment_method,o.total,u.full_name AS "fullName",
      COALESCE(STRING_AGG(DISTINCT oi.item_name,' · ' ORDER BY oi.item_name),'') AS products
    FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE ${where}
    GROUP BY o.id,o.created_at,o.payment_method,o.total,u.full_name
    ORDER BY o.created_at DESC,o.id DESC`,params);
  const sum=await q(`SELECT COUNT(*)::int orders,COALESCE(SUM(o.total),0)::int total,
      COALESCE(SUM(CASE WHEN o.payment_method='cash' THEN o.total ELSE 0 END),0)::int cash,
      COALESCE(SUM(CASE WHEN o.payment_method='transfer' THEN o.total ELSE 0 END),0)::int transfer
    FROM orders o WHERE ${where}`,params);
  res.json({orders:r.rows,summary:sum.rows[0]});
});

app.get('/api/orders/:id',auth,async(req,res)=>{
  const o=await q(`SELECT o.*,u.full_name AS staff,c.full_name AS customer_name FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=$1`,[req.params.id]);
  if(!o.rowCount)return res.status(404).json({message:'Không tìm thấy hóa đơn'});
  const items=await q(`SELECT oi.*,COALESCE(json_agg(json_build_object('name',oit.topping_name,'price',oit.topping_price,'quantity',oit.quantity)) FILTER (WHERE oit.id IS NOT NULL),'[]') toppings FROM order_items oi LEFT JOIN order_item_toppings oit ON oit.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY oi.id ORDER BY oi.id`,[req.params.id]);
  res.json({...o.rows[0],items:items.rows});
});

app.get('/api/admin/users',auth,adminOnly,async(req,res)=>{
  // Quản lý chỉ được xem danh sách nhân viên; admin tổng mới thấy toàn bộ tài khoản.
  const sql = req.user.role === 'manager'
    ? 'SELECT id,username,full_name AS "fullName",birth_date AS "birthDate",role,active,created_at FROM users WHERE role=\'staff\' ORDER BY id'
    : 'SELECT id,username,full_name AS "fullName",birth_date AS "birthDate",role,active,created_at FROM users ORDER BY id';
  const r=await q(sql);
  res.json(r.rows);
});
app.post('/api/admin/users',auth,adminOnly,async(req,res)=>{const {username,password,fullName,role='staff',birthDate}=req.body;if(!username||!password||!fullName||!birthDate)return res.status(400).json({message:'Vui lòng nhập đầy đủ tài khoản, mật khẩu, họ tên và ngày tháng năm sinh'});if(!['manager','staff'].includes(role))return res.status(400).json({message:'Role không hợp lệ'});if(!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate)))return res.status(400).json({message:'Ngày tháng năm sinh không hợp lệ'});try{const h=await bcrypt.hash(password,10);const r=await q('INSERT INTO users(username,password_hash,full_name,birth_date,role) VALUES($1,$2,$3,$4,$5) RETURNING id,username,full_name AS "fullName",birth_date AS "birthDate",role,active',[username,h,fullName,birthDate,role]);res.json(r.rows[0]);}catch(e){res.status(400).json({message:'Username đã tồn tại'});}});
app.put('/api/admin/users/:id',auth,adminOnly,async(req,res)=>{const target=await q('SELECT id,username,role FROM users WHERE id=$1',[req.params.id]);if(!target.rowCount)return res.status(404).json({message:'Không tìm thấy tài khoản'});if(target.rows[0].username==='admin')return res.status(403).json({message:'Tài khoản quản trị gốc không thể chỉnh sửa'});if(req.user.role==='manager' && target.rows[0].role!=='staff')return res.status(403).json({message:'Quản lý chỉ được chỉnh sửa tài khoản nhân viên'});const {fullName,password,role,active,birthDate}=req.body;const sets=[];const vals=[];if(fullName!==undefined){vals.push(fullName);sets.push(`full_name=$${vals.length}`)}if(birthDate!==undefined){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate)))return res.status(400).json({message:'Ngày tháng năm sinh không hợp lệ'});vals.push(birthDate);sets.push(`birth_date=$${vals.length}`)}if(role!==undefined){if(!['manager','staff'].includes(role))return res.status(400).json({message:'Role không hợp lệ'});vals.push(role);sets.push(`role=$${vals.length}`)}if(active!==undefined){vals.push(!!active);sets.push(`active=$${vals.length}`)}if(password){vals.push(await bcrypt.hash(password,10));sets.push(`password_hash=$${vals.length}`)}if(!sets.length)return res.json({ok:true});vals.push(req.params.id);const r=await q(`UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,username,full_name AS "fullName",birth_date AS "birthDate",role,active`,vals);res.json(r.rows[0]);});
app.delete('/api/admin/users/:id',auth,adminOnly,async(req,res)=>{if(Number(req.params.id)===req.user.id)return res.status(400).json({message:'Không thể xóa tài khoản đang đăng nhập'});const target=await q('SELECT id,username,role FROM users WHERE id=$1',[req.params.id]);if(!target.rowCount)return res.status(404).json({message:'Không tìm thấy tài khoản'});if(target.rows[0].username==='admin')return res.status(403).json({message:'Tài khoản quản trị gốc không thể xóa'});if(req.user.role==='manager' && target.rows[0].role!=='staff')return res.status(403).json({message:'Quản lý chỉ được xóa tài khoản nhân viên'});const r=await q('DELETE FROM users WHERE id=$1 RETURNING id,username',[req.params.id]);res.json({ok:true,user:r.rows[0]});});

app.post('/api/admin/menu',auth,adminOnly,upload.single('image'),async(req,res)=>{
  const {name,category='Khác',price}=req.body;
  if(!name||price===undefined)return res.status(400).json({message:'Thiếu tên/giá'});
  const cat=await q('SELECT id FROM categories WHERE name=$1 AND active=true',[category]);
  if(!cat.rowCount)return res.status(400).json({message:'Danh mục không tồn tại'});
  try {
    const imageBlob=req.file?.buffer || null;
    const imageMime=req.file?.mimetype || null;
    const r=await q(`INSERT INTO menu_items(name,category,price,image_path,image_data,image_blob,image_mime)
      VALUES($1,$2,$3,NULL,NULL,$4,$5)
      RETURNING id,name,category,price,
        CASE WHEN image_blob IS NOT NULL THEN '/api/menu/' || id || '/image?v=' || EXTRACT(EPOCH FROM updated_at)::bigint ELSE NULL END AS image,
        active`,
      [name,category,money(price),imageBlob,imageMime]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({message:e.message||'Không thể lưu ảnh vào Neon'}); }
});

app.put('/api/admin/menu/:id',auth,adminOnly,upload.single('image'),async(req,res)=>{
  const {name,category,price,active}=req.body;
  const current=await q('SELECT * FROM menu_items WHERE id=$1',[req.params.id]);
  if(!current.rowCount)return res.status(404).json({message:'Không tìm thấy món'});
  const sets=[];const vals=[];
  if(category!==undefined){const cat=await q('SELECT id FROM categories WHERE name=$1 AND active=true',[category]);if(!cat.rowCount)return res.status(400).json({message:'Danh mục không tồn tại'});}
  for(const [k,v] of [['name',name],['category',category],['price',price!==undefined?money(price):undefined],['active',active!==undefined?active!=='false':undefined]]){
    if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}
  }
  if(req.file){
    vals.push(req.file.buffer); sets.push(`image_blob=$${vals.length}`);
    vals.push(req.file.mimetype || 'application/octet-stream'); sets.push(`image_mime=$${vals.length}`);
    sets.push('image_path=NULL');
    sets.push('image_data=NULL');
  }
  vals.push(req.params.id);
  const r=await q(`UPDATE menu_items SET ${sets.length?sets.join(',')+',':''} updated_at=NOW() WHERE id=$${vals.length}
    RETURNING id,name,category,price,
      CASE WHEN image_blob IS NOT NULL THEN '/api/menu/' || id || '/image?v=' || EXTRACT(EPOCH FROM updated_at)::bigint ELSE NULL END AS image,
      active`,vals);
  res.json(r.rows[0]);
});

app.delete('/api/admin/menu/:id',auth,adminOnly,async(req,res)=>{
  const current=await q('SELECT id FROM menu_items WHERE id=$1',[req.params.id]);
  if(!current.rowCount)return res.status(404).json({message:'Không tìm thấy món'});
  await q('UPDATE menu_items SET active=false,image_path=NULL,image_data=NULL,image_blob=NULL,image_mime=NULL,updated_at=NOW() WHERE id=$1',[req.params.id]);
  res.json({ok:true});
});
app.post('/api/admin/categories',auth,adminOnly,async(req,res)=>{
  const name=String(req.body.name||'').trim();
  if(!name)return res.status(400).json({message:'Nhập tên danh mục'});
  if(name.length>40)return res.status(400).json({message:'Tên danh mục tối đa 40 ký tự'});

  try{
    // Nếu danh mục đã từng bị XÓA (active=false), khôi phục lại thay vì
    // INSERT mới. Trước đây DB vẫn giữ bản ghi cũ nên INSERT bị lỗi UNIQUE
    // và giao diện báo "Danh mục đã tồn tại".
    const existing=await q(
      'SELECT id,name,active FROM categories WHERE LOWER(name)=LOWER($1) ORDER BY active DESC,id LIMIT 1',
      [name]
    );

    if(existing.rowCount){
      const c=existing.rows[0];

      if(c.active){
        return res.status(400).json({message:'Danh mục đã tồn tại'});
      }

      const restored=await q(
        'UPDATE categories SET name=$1,active=true,updated_at=NOW() WHERE id=$2 RETURNING id,name',
        [name,c.id]
      );

      return res.json(restored.rows[0]);
    }

    const r=await q(
      'INSERT INTO categories(name) VALUES($1) RETURNING id,name',
      [name]
    );
    res.json(r.rows[0]);
  }catch(e){
    console.error('Create category error:',e);
    res.status(400).json({message:'Danh mục đã tồn tại'});
  }
});
app.put('/api/admin/categories/:id',auth,adminOnly,async(req,res)=>{
  const name=String(req.body.name||'').trim();
  if(!name)return res.status(400).json({message:'Nhập tên danh mục'});

  try{
    const old=await q(
      'SELECT name FROM categories WHERE id=$1 AND active=true',
      [req.params.id]
    );
    if(!old.rowCount)return res.status(404).json({message:'Không tìm thấy danh mục'});

    const duplicate=await q(
      'SELECT id FROM categories WHERE LOWER(name)=LOWER($1) AND id<>$2 AND active=true LIMIT 1',
      [name,req.params.id]
    );
    if(duplicate.rowCount){
      return res.status(400).json({message:'Tên danh mục đã tồn tại'});
    }

    const r=await q(
      'UPDATE categories SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name',
      [name,req.params.id]
    );
    await q(
      'UPDATE menu_items SET category=$1,updated_at=NOW() WHERE category=$2',
      [name,old.rows[0].name]
    );
    res.json(r.rows[0]);
  }catch(e){
    console.error('Update category error:',e);
    res.status(400).json({message:'Tên danh mục đã tồn tại'});
  }
});
app.delete('/api/admin/categories/:id',auth,adminOnly,async(req,res)=>{const c=await q('SELECT name FROM categories WHERE id=$1 AND active=true',[req.params.id]);if(!c.rowCount)return res.status(404).json({message:'Không tìm thấy danh mục'});const used=await q('SELECT COUNT(*)::int n FROM menu_items WHERE category=$1 AND active=true',[c.rows[0].name]);if(used.rows[0].n>0)return res.status(400).json({message:`Danh mục đang được dùng bởi ${used.rows[0].n} món. Hãy chuyển món sang danh mục khác trước.`});await q('UPDATE categories SET active=false,updated_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.post('/api/admin/toppings',auth,adminOnly,async(req,res)=>{const {name,price=0}=req.body;const r=await q('INSERT INTO toppings(name,price) VALUES($1,$2) RETURNING *',[name,money(price)]);res.json(r.rows[0]);});
app.put('/api/admin/toppings/:id',auth,adminOnly,async(req,res)=>{const {name,price,active}=req.body;const r=await q('UPDATE toppings SET name=COALESCE($1,name),price=COALESCE($2,price),active=COALESCE($3,active) WHERE id=$4 RETURNING *',[name,price!==undefined?money(price):null,active!==undefined?active:null,req.params.id]);res.json(r.rows[0]);});
app.delete('/api/admin/toppings/:id',auth,adminOnly,async(req,res)=>{await q('UPDATE toppings SET active=false WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.put('/api/admin/payos-credentials',auth,payOSAdminOnly,async(req,res)=>{
  const clientId=String(req.body.clientId||'').trim();
  const apiKey=String(req.body.apiKey||'').trim();
  const checksumKey=String(req.body.checksumKey||'').trim();
  if(!clientId || !apiKey || !checksumKey) return res.status(400).json({message:'Nhập đầy đủ Client ID, API Key và Checksum Key'});
  try{
    const candidate={clientId,apiKey,checksumKey};
    const candidatePayOS=makePayOS(candidate);
    const webhookUrl=`${publicBaseUrl()}/api/payos/webhook`;
    const result=await candidatePayOS.webhooks.confirm(webhookUrl);
    await q("INSERT INTO settings(key,value) VALUES('payos_credentials',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[encryptPayOSConfig(candidate)]);
    res.json({ok:true,source:'database',clientId,webhookUrl,result});
  }catch(e){
    console.error('payOS credential update error:',e);
    res.status(400).json({message:e?.message||'Không thể kết nối kênh payOS mới. Kiểm tra lại 3 key.'});
  }
});

app.get('/api/admin/discount-rules',auth,adminOnly,async(req,res)=>{ const r=await q("SELECT value FROM settings WHERE key='discount_rules'"); let rules=[]; try{rules=JSON.parse(r.rows[0]?.value||'[]')}catch{} res.json({rules:Array.isArray(rules)?rules:[]}); });
app.post('/api/admin/discount-rules',auth,adminOnly,async(req,res)=>{ const threshold=money(req.body.threshold), percent=Math.min(100,Math.max(0,money(req.body.percent))); if(threshold<=0)return res.status(400).json({message:'Giá trị hóa đơn phải lớn hơn 0'}); if(percent<=0)return res.status(400).json({message:'Phần trăm giảm phải lớn hơn 0'}); const r=await q("SELECT value FROM settings WHERE key='discount_rules'"); let rules=[]; try{rules=JSON.parse(r.rows[0]?.value||'[]')}catch{}; rules=Array.isArray(rules)?rules:[]; rules=rules.filter(x=>money(x.threshold)!==threshold); rules.push({threshold,percent}); rules.sort((a,b)=>a.threshold-b.threshold); await q("INSERT INTO settings(key,value) VALUES('discount_rules',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(rules)]); res.json({rules}); });
app.delete('/api/admin/discount-rules/:threshold',auth,adminOnly,async(req,res)=>{ const threshold=money(req.params.threshold); const r=await q("SELECT value FROM settings WHERE key='discount_rules'"); let rules=[]; try{rules=JSON.parse(r.rows[0]?.value||'[]')}catch{}; rules=(Array.isArray(rules)?rules:[]).filter(x=>money(x.threshold)!==threshold); await q("INSERT INTO settings(key,value) VALUES('discount_rules',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(rules)]); res.json({rules}); });

// payOS: tạo payment link/QR cho đúng hóa đơn. Order đã được tạo ở trạng thái pending.
app.post('/api/payos/create-payment', auth, async (req,res)=>{
  const payosConfig=await getPayOSConfig();
  const payos=makePayOS(payosConfig);
  if(!payos) return res.status(503).json({message:'payOS chưa được cấu hình. Admin tổng hãy vào Cài đặt → Kênh thanh toán payOS để nhập bộ key mới.'});
  const orderId=Number(req.body.orderId);
  if(!Number.isInteger(orderId) || orderId<=0) return res.status(400).json({message:'Mã đơn không hợp lệ'});
  try{
    const r=await q(`SELECT id,total,status,payment_method FROM orders WHERE id=$1 AND user_id=$2 LIMIT 1`,[orderId,req.user.id]);
    if(!r.rowCount) return res.status(404).json({message:'Không tìm thấy đơn hàng'});
    const order=r.rows[0];
    if(order.payment_method!=='transfer') return res.status(400).json({message:'Đơn này không phải thanh toán chuyển khoản'});
    if(order.status==='paid') return res.status(400).json({message:'Đơn hàng đã thanh toán'});
    if(order.status!=='pending') return res.status(400).json({message:`Đơn hàng đang ở trạng thái ${order.status}`});
    if(Number(order.total)<=0) return res.status(400).json({message:'Tổng tiền phải lớn hơn 0'});

    const base=publicBaseUrl();
    const paymentLink=await payos.paymentRequests.create({
      orderCode: order.id,
      amount: Number(order.total),
      description: 'Thanh toan CF Mindset',
      returnUrl: `${base}/?payos=success&orderCode=${order.id}`,
      cancelUrl: `${base}/?payos=cancel&orderCode=${order.id}`,
    });

    res.json({
      orderId: order.id,
      total: Number(order.total),
      checkoutUrl: paymentLink.checkoutUrl || '',
      qrCode: paymentLink.qrCode || '',
      qrImage: paymentLink.qrCode ? await QRCode.toDataURL(paymentLink.qrCode, { width: 300, margin: 1, errorCorrectionLevel: 'M' }) : '',
      paymentLinkId: paymentLink.paymentLinkId || paymentLink.id || null,
    });
  }catch(e){
    console.error('payOS create payment error:',e);
    res.status(502).json({message:e?.message||'Không tạo được thanh toán payOS'});
  }
});

app.post('/api/payos/cancel-payment/:orderId', auth, async (req,res)=>{
  const orderId=Number(req.params.orderId);
  if(!Number.isInteger(orderId) || orderId<=0) return res.status(400).json({message:'Mã đơn không hợp lệ'});
  try{
    const r=await q(`SELECT id,status,payment_method FROM orders WHERE id=$1 AND user_id=$2 LIMIT 1`,[orderId,req.user.id]);
    if(!r.rowCount) return res.status(404).json({message:'Không tìm thấy đơn hàng'});
    const order=r.rows[0];
    if(order.payment_method!=='transfer') return res.status(400).json({message:'Đơn này không phải thanh toán chuyển khoản'});
    if(order.status==='cancelled') return res.json({ok:true,cancelled:true,payOSCancelled:true});
    if(order.status==='paid') return res.status(409).json({message:'Đơn hàng đã thanh toán, không thể hủy'});
    if(!['pending','cancelling'].includes(order.status)) return res.status(400).json({message:`Đơn hàng đang ở trạng thái ${order.status}`});

    // Đổi trạng thái local ngay lập tức để UI phản hồi nhanh. Nếu khách chuyển tiền
    // đúng lúc payOS đang xử lý hủy, webhook vẫn có thể chuyển cancelling -> paid.
    const marked=await q(`UPDATE orders SET status='cancelling' WHERE id=$1 AND user_id=$2 AND payment_method='transfer' AND status='pending' RETURNING id`,[orderId,req.user.id]);
    if(!marked.rowCount && order.status!=='cancelling') return res.status(409).json({message:'Đơn hàng đã thay đổi trạng thái'});

    res.json({ok:true,cancelled:true,cancelling:true});

    // Hủy payment link ở payOS phía sau, không bắt người dùng chờ API payOS.
    setImmediate(async()=>{
      try{
        const payosConfig=await getPayOSConfig();
        const payos=makePayOS(payosConfig);
        if(!payos) throw new Error('payOS chưa được cấu hình');
        await payos.paymentRequests.cancel(orderId, 'Khach huy');
        const cancelled = await q(`UPDATE orders SET status='cancelled' WHERE id=$1 AND status='cancelling' RETURNING member_reward_id,member_reward_quantity`,[orderId]);
        if (cancelled.rowCount && Number(cancelled.rows[0].member_reward_quantity||0) > 0 && cancelled.rows[0].member_reward_id) {
          await q(`UPDATE member_rewards SET remaining_quantity=remaining_quantity+$1,redeemed_at=NULL,redeemed_by=NULL,updated_at=NOW() WHERE id=$2`, [Number(cancelled.rows[0].member_reward_quantity||0), cancelled.rows[0].member_reward_id]);
        }
      }catch(cancelError){
        console.error('payOS payment link cancel error:', cancelError);
        // Nếu chưa có webhook thanh toán thì cho đơn quay lại pending để không làm mất QR.
        await q(`UPDATE orders SET status='pending' WHERE id=$1 AND status='cancelling'`,[orderId]).catch(()=>{});
      }
    });
  }catch(e){
    console.error('payOS cancel payment error:',e);
    if(!res.headersSent) res.status(500).json({message:e?.message || 'Không hủy được đơn thanh toán'});
  }
});

app.get('/api/payos/payment-status/:orderId', auth, async (req,res)=>{
  const orderId=Number(req.params.orderId);
  if(!Number.isInteger(orderId)) return res.status(400).json({message:'Mã đơn không hợp lệ'});
  try{
    const r=await q(`SELECT id,total,status,payment_method FROM orders WHERE id=$1 AND user_id=$2 LIMIT 1`,[orderId,req.user.id]);
    if(!r.rowCount) return res.status(404).json({message:'Không tìm thấy đơn hàng'});
    res.json({orderId:r.rows[0].id,total:Number(r.rows[0].total),status:r.rows[0].status,paymentMethod:r.rows[0].payment_method});
  }catch(e){
    console.error('payOS payment status error:',e);
    res.status(500).json({message:'Không lấy được trạng thái thanh toán'});
  }
});

app.post('/api/payos/webhook', async (req,res)=>{
  const payosConfig=await getPayOSConfig();
  const payos=makePayOS(payosConfig);
  if(!payos) return res.status(503).send('payOS not configured');
  try{
    const verified=await payos.webhooks.verify(req.body);
    const data=verified?.data && typeof verified.data==='object' ? verified.data : verified;
    const orderCode=Number(data?.orderCode);
    const amount=Number(data?.amount);
    const code=String(data?.code ?? verified?.code ?? '');
    const success=verified?.success !== false && code === '00';

    if(!success || !Number.isInteger(orderCode) || orderCode<=0){
      console.log('payOS webhook ignored:', {success,orderCode,code});
      return res.status(200).send('OK');
    }

    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const or=await client.query(`SELECT id,total,status,customer_id,points_used,points_earned FROM orders WHERE id=$1 AND payment_method='transfer' FOR UPDATE`,[orderCode]);
      if(!or.rowCount){
        await client.query('ROLLBACK');
        console.warn('payOS webhook: order not found',orderCode);
        return res.status(200).send('OK');
      }
      const order=or.rows[0];
      if(Number(order.total)!==amount){
        await client.query('ROLLBACK');
        console.error('payOS webhook amount mismatch:',{orderCode,expected:Number(order.total),received:amount});
        return res.status(400).send('Amount mismatch');
      }
      if(order.status==='paid'){
        await client.query('ROLLBACK');
        return res.status(200).send('OK');
      }
      if(!['pending','cancelling'].includes(order.status)){
        await client.query('ROLLBACK');
        console.log('payOS webhook ignored for non-pending order:', {orderCode,status:order.status});
        return res.status(200).send('OK');
      }

      if(order.customer_id){
        const cr=await client.query('SELECT id,points FROM customers WHERE id=$1 FOR UPDATE',[order.customer_id]);
        if(cr.rowCount){
          const currentPoints=Number(cr.rows[0].points||0);
          const pointsUsed=Math.min(Number(order.points_used||0),currentPoints);
          const pointsEarned=Number(order.points_earned||0);
          const newPoints=Math.max(0,currentPoints-pointsUsed+pointsEarned);
          await client.query('UPDATE customers SET points=$1,updated_at=NOW() WHERE id=$2',[newPoints,order.customer_id]);
        }
        const spendNow = await client.query(`SELECT COALESCE(SUM(total),0)::int AS total FROM orders WHERE customer_id=$1 AND status='paid' AND created_at >= date_trunc('year', NOW())`,[order.customer_id]);
        await client.query(`UPDATE orders SET status='paid' WHERE id=$1`,[order.id]);
        const spendAfter = Number(spendNow.rows[0]?.total||0) + Number(order.total||0);
        await syncMemberCoupon(order.customer_id, spendAfter, client);
      } else {
        await client.query(`UPDATE orders SET status='paid' WHERE id=$1`,[order.id]);
      }
      await client.query('COMMIT');
      console.log('payOS payment confirmed:',{orderCode,amount,reference:data?.reference||null});
      return res.status(200).send('OK');
    }catch(e){
      await client.query('ROLLBACK');
      throw e;
    }finally{client.release();}
  }catch(e){
    console.error('payOS webhook verify/process error:',e);
    return res.status(400).send('Invalid webhook');
  }
});

app.post('/api/payos/confirm-webhook', auth, payOSAdminOnly, async (req,res)=>{
  const payosConfig=await getPayOSConfig();
  const payos=makePayOS(payosConfig);
  if(!payos) return res.status(503).json({message:'payOS chưa được cấu hình'});
  try{
    const webhookUrl=`${publicBaseUrl()}/api/payos/webhook`;
    const result=await payos.webhooks.confirm(webhookUrl);
    res.json({ok:true,webhookUrl,result});
  }catch(e){
    console.error('payOS confirm webhook error:',e);
    res.status(502).json({message:e?.message||'Không đăng ký được webhook với payOS'});
  }
});

app.get('/api/admin/reports/summary',auth,adminOnly,async(req,res)=>{
  const {from,to}=req.query;
  const today=localDateString();
  const start=`${from || today}T00:00:00+07:00`;
  const end=`${to || today}T23:59:59.999+07:00`;
  const total=await q(`SELECT COALESCE(SUM(total),0)::int total,COUNT(*)::int orders,COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0)::int cash,COALESCE(SUM(CASE WHEN payment_method='transfer' THEN total ELSE 0 END),0)::int transfer FROM orders WHERE created_at BETWEEN $1 AND $2 AND status='paid'`,[start,end]);
  const byStaff=await q(`SELECT u.id,u.full_name AS "fullName",COUNT(o.id)::int orders,COALESCE(SUM(o.total),0)::int revenue FROM users u LEFT JOIN orders o ON o.user_id=u.id AND o.created_at BETWEEN $1 AND $2 AND o.status='paid' GROUP BY u.id ORDER BY revenue DESC`,[start,end]);
  const byDay=await q(`SELECT TO_CHAR(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') day,COUNT(*)::int orders,COALESCE(SUM(total),0)::int revenue FROM orders WHERE created_at BETWEEN $1 AND $2 AND status='paid' GROUP BY 1 ORDER BY 1`,[start,end]);
  res.json({summary:total.rows[0],byStaff:byStaff.rows,byDay:byDay.rows});
});
app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));

async function confirmPayOSWebhookOnStartup() {
  const payosConfig=await getPayOSConfig();
  const payos=makePayOS(payosConfig);
  if(!payos){
    console.log('payOS disabled: no database credentials and no PAYOS_* environment credentials');
    return;
  }
  const webhookUrl=`${publicBaseUrl()}/api/payos/webhook`;
  try{
    const result=await payos.webhooks.confirm(webhookUrl);
    console.log(`payOS webhook ready (${payosConfig.source}):`, result?.webhookUrl || result?.data?.webhookUrl || webhookUrl);
  }catch(e){
    console.error('payOS webhook setup failed:',e?.message||e);
    console.error('Check the active payOS channel keys in Cài đặt → Kênh thanh toán payOS.');
  }
}

initDb()
  .then(()=>app.listen(PORT,()=>{
    console.log(`Mindset POS running on ${PORT}`);
    setTimeout(confirmPayOSWebhookOnStartup, 1500);
  }))
  .catch(err=>{console.error(err);process.exit(1)});
;
