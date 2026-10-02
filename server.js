import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Cấu hình lại Pool để nhận dạng môi trường Render chính xác hơn
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') 
    ? { rejectUnauthorized: false } 
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false)
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const q = (text, params=[]) => pool.query(text, params);

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await q(schema);
  const count = await q('SELECT COUNT(*)::int AS n FROM users');
  if (count.rows[0].n === 0) {
    const a = await bcrypt.hash('admin123', 10);
    const s = await bcrypt.hash('123456', 10);
    await q(`INSERT INTO users(username,password_hash,full_name,role) VALUES ($1,$2,$3,'admin'),($4,$5,$6,'staff')`, ['admin',a,'Quản trị viên','nhanvien',s,'Đạt']);
  }
  const menuCount = await q('SELECT COUNT(*)::int AS n FROM menu_items');
  if (menuCount.rows[0].n === 0) {
    const items = [
      ['Cà phê đen','Cà phê',25000,'ca-phe-den.jpg'],['Cà phê sữa','Cà phê',28000,'ca-phe-sua.jpg'],['Americano','Cà phê',25000,'americano.jpg'],['Latte','Cà phê',35000,'latte.jpg'],['Cappuccino','Cà phê',35000,'cappuccino.jpg'],
      ['Cold Brew','Cà phê',35000,'cold-brew.jpg'],['Bạc xỉu','Cà phê',32000,'bac-xiu.jpg'],['Matcha Latte','Trà',40000,'matcha-latte.jpg'],['Trà đào','Trà',35000,'tra-dao.jpg'],['Trà vải','Trà',35000,'tra-vai.jpg'],
      ['Trà ô long','Trà',30000,'tra-o-long.jpg'],['Trà lài','Trà',30000,'tra-lai.jpg'],['Chocolate','Khác',35000,'chocolate.jpg'],['Đá xay socola','Đá xay',45000,'da-xay-socola.jpg'],['Đá xay matcha','Đá xay',45000,'da-xay-matcha.jpg']
    ];
    for (const [name,cat,price,file] of items) {
      const p = path.join(__dirname,'public/assets/menu',file);
      const data = fs.existsSync(p) ? `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}` : null;
      await q('INSERT INTO menu_items(name,category,price,image_data) VALUES($1,$2,$3,$4)',[name,cat,price,data]);
    }
  }
  const topCount = await q('SELECT COUNT(*)::int AS n FROM toppings');
  if (topCount.rows[0].n === 0) {
    await q(`INSERT INTO toppings(name,price) VALUES ('Trân châu',5000),('Thạch',5000),('Kem cheese',8000),('Shot espresso',10000),('Sữa tươi',5000)`);
  }
  await q(`INSERT INTO settings(key,value) VALUES('payment_qr','') ON CONFLICT(key) DO NOTHING`);
}

function sign(user) { return jwt.sign({ id:user.id, username:user.username, fullName:user.full_name, role:user.role }, JWT_SECRET, { expiresIn:'12h' }); }
function auth(req,res,next) {
  try {
    const token = req.cookies.mindset_token;
    if (!token) return res.status(401).json({message:'Chưa đăng nhập'});
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({message:'Phiên đăng nhập đã hết hạn'}); }
}
function adminOnly(req,res,next){ if(req.user.role!=='admin') return res.status(403).json({message:'Chỉ admin được phép'}); next(); }
function money(n){ return Math.round(Number(n)||0); }

app.get('/api/health', async (_,res)=>{ try { await q('SELECT 1'); res.json({ok:true}); } catch(e){ res.status(500).json({ok:false}); }});

app.post('/api/auth/login', async (req,res)=>{
  const {username,password}=req.body;
  const r=await q('SELECT * FROM users WHERE username=$1 AND active=true',[username]);
  if(!r.rowCount || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({message:'Sai tài khoản hoặc mật khẩu'});
  const u=r.rows[0];
  res.cookie('mindset_token',sign(u),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:12*60*60*1000});
  res.json({user:{id:u.id,username:u.username,fullName:u.full_name,role:u.role}});
});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('mindset_token');res.json({ok:true});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:{id:req.user.id,username:req.user.username,fullName:req.user.fullName,role:req.user.role}}));

app.get('/api/menu',auth,async(req,res)=>{ const r=await q('SELECT id,name,category,price,image_data AS image,active FROM menu_items WHERE active=true ORDER BY id'); res.json(r.rows); });
app.get('/api/toppings',auth,async(req,res)=>{ const r=await q('SELECT id,name,price FROM toppings WHERE active=true ORDER BY id'); res.json(r.rows); });
app.get('/api/settings/qr',auth,async(req,res)=>{ const r=await q("SELECT value FROM settings WHERE key='payment_qr'"); res.json({image:r.rows[0]?.value||''}); });

app.post('/api/shifts/clock-in',auth,async(req,res)=>{
  const active=await q('SELECT id FROM shifts WHERE user_id=$1 AND clock_out IS NULL',[req.user.id]);
  if(active.rowCount) return res.json({id:active.rows[0].id});
  const r=await q('INSERT INTO shifts(user_id) VALUES($1) RETURNING id,clock_in',[req.user.id]); res.json(r.rows[0]);
});
app.post('/api/shifts/clock-out',auth,async(req,res)=>{ const r=await q('UPDATE shifts SET clock_out=NOW() WHERE user_id=$1 AND clock_out IS NULL RETURNING *',[req.user.id]); if(!r.rowCount)return res.status(400).json({message:'Không có ca đang mở'}); res.json(r.rows[0]); });
app.get('/api/shifts/current',auth,async(req,res)=>{ const r=await q('SELECT * FROM shifts WHERE user_id=$1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1',[req.user.id]); res.json(r.rows[0]||null); });

app.post('/api/orders',auth,async(req,res)=>{
  const {items,paymentMethod,discount=0}=req.body;
  if(!Array.isArray(items)||!items.length) return res.status(400).json({message:'Giỏ hàng trống'});
  if(!['cash','transfer'].includes(paymentMethod)) return res.status(400).json({message:'Phương thức thanh toán không hợp lệ'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const shift=await client.query('SELECT id FROM shifts WHERE user_id=$1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1',[req.user.id]);
    const shiftId=shift.rows[0]?.id||null;
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
      const line=(Number(m.price)+topTotal)*qty; subtotal+=line; normalized.push({m,qty,tops,line});
    }
    const disc=Math.min(subtotal,Math.max(0,money(discount)));
    const total=subtotal-disc;
    const order=await client.query(`INSERT INTO orders(user_id,shift_id,payment_method,subtotal,discount,total,status) VALUES($1,$2,$3,$4,$5,$6,'paid') RETURNING *`,[req.user.id,shiftId,paymentMethod,subtotal,disc,total]);
    for(const x of normalized){
      const oi=await client.query(`INSERT INTO order_items(order_id,menu_item_id,item_name,unit_price,quantity,line_total) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[order.rows[0].id,x.m.id,x.m.name,x.m.price,x.qty,x.line]);
      for(const t of x.tops) await client.query(`INSERT INTO order_item_toppings(order_item_id,topping_id,topping_name,topping_price,quantity) VALUES($1,$2,$3,$4,$5)`,[oi.rows[0].id,t.id,t.name,t.price,t.quantity]);
    }
    await client.query('COMMIT');
    res.json({orderId:order.rows[0].id,total,subtotal,discount:disc});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({message:e.message||'Không tạo được đơn'});}finally{client.release();}
});

app.get('/api/admin/reports/recent-orders',auth,async(req,res)=>{
  const r=await q(`SELECT o.id,o.created_at,o.payment_method,o.total,u.full_name AS "fullName" FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 100`);
  res.json({orders:r.rows});
});

app.get('/api/orders/:id',auth,async(req,res)=>{
  const o=await q(`SELECT o.*,u.full_name AS staff FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[req.params.id]);
  if(!o.rowCount)return res.status(404).json({message:'Không tìm thấy hóa đơn'});
  const items=await q(`SELECT oi.*,COALESCE(json_agg(json_build_object('name',oit.topping_name,'price',oit.topping_price,'quantity',oit.quantity)) FILTER (WHERE oit.id IS NOT NULL),'[]') toppings FROM order_items oi LEFT JOIN order_item_toppings oit ON oit.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY oi.id ORDER BY oi.id`,[req.params.id]);
  res.json({...o.rows[0],items:items.rows});
});

app.get('/api/admin/users',auth,adminOnly,async(req,res)=>{const r=await q('SELECT id,username,full_name AS "fullName",role,active,created_at FROM users ORDER BY id');res.json(r.rows);});
app.post('/api/admin/users',auth,adminOnly,async(req,res)=>{const {username,password,fullName,role='staff'}=req.body;if(!username||!password||!fullName)return res.status(400).json({message:'Thiếu thông tin'});if(!['admin','staff'].includes(role))return res.status(400).json({message:'Role không hợp lệ'});try{const h=await bcrypt.hash(password,10);const r=await q('INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,$3,$4) RETURNING id,username,full_name AS "fullName",role,active',[username,h,fullName,role]);res.json(r.rows[0]);}catch(e){res.status(400).json({message:'Username đã tồn tại'});}});
app.put('/api/admin/users/:id',auth,adminOnly,async(req,res)=>{const {fullName,password,role,active}=req.body;const sets=[];const vals=[];if(fullName!==undefined){vals.push(fullName);sets.push(`full_name=$${vals.length}`)}if(role!==undefined){if(!['admin','staff'].includes(role))return res.status(400).json({message:'Role không hợp lệ'});vals.push(role);sets.push(`role=$${vals.length}`)}if(active!==undefined){vals.push(!!active);sets.push(`active=$${vals.length}`)}if(password){vals.push(await bcrypt.hash(password,10));sets.push(`password_hash=$${vals.length}`)}if(!sets.length)return res.json({ok:true});vals.push(req.params.id);const r=await q(`UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,username,full_name AS "fullName",role,active`,vals);res.json(r.rows[0]);});
app.delete('/api/admin/users/:id',auth,adminOnly,async(req,res)=>{if(Number(req.params.id)===req.user.id)return res.status(400).json({message:'Không thể xóa tài khoản đang đăng nhập'});await q('UPDATE users SET active=false WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.post('/api/admin/menu',auth,adminOnly,upload.single('image'),async(req,res)=>{const {name,category='Khác',price}=req.body;if(!name||price===undefined)return res.status(400).json({message:'Thiếu tên/giá'});const img=req.file?`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`:null;const r=await q('INSERT INTO menu_items(name,category,price,image_data) VALUES($1,$2,$3,$4) RETURNING id,name,category,price,image_data AS image,active',[name,category,money(price),img]);res.json(r.rows[0]);});
app.put('/api/admin/menu/:id',auth,adminOnly,upload.single('image'),async(req,res)=>{const {name,category,price,active}=req.body;const sets=[];const vals=[];for(const [k,v] of [['name',name],['category',category],['price',price!==undefined?money(price):undefined],['active',active!==undefined?active!=='false':undefined]]){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(req.file){vals.push(`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`);sets.push(`image_data=$${vals.length}`)}vals.push(req.params.id);const r=await q(`UPDATE menu_items SET ${sets.join(',')},updated_at=NOW() WHERE id=$${vals.length} RETURNING id,name,category,price,image_data AS image,active`,vals);res.json(r.rows[0]);});
app.delete('/api/admin/menu/:id',auth,adminOnly,async(req,res)=>{await q('UPDATE menu_items SET active=false WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.post('/api/admin/toppings',auth,adminOnly,async(req,res)=>{const {name,price=0}=req.body;const r=await q('INSERT INTO toppings(name,price) VALUES($1,$2) RETURNING *',[name,money(price)]);res.json(r.rows[0]);});
app.put('/api/admin/toppings/:id',auth,adminOnly,async(req,res)=>{const {name,price,active}=req.body;const r=await q('UPDATE toppings SET name=COALESCE($1,name),price=COALESCE($2,price),active=COALESCE($3,active) WHERE id=$4 RETURNING *',[name,price!==undefined?money(price):null,active!==undefined?active:null,req.params.id]);res.json(r.rows[0]);});
app.delete('/api/admin/toppings/:id',auth,adminOnly,async(req,res)=>{await q('UPDATE toppings SET active=false WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.post('/api/admin/qr',auth,adminOnly,upload.single('qr'),async(req,res)=>{if(!req.file)return res.status(400).json({message:'Chưa chọn file'});const data=`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;await q("UPDATE settings SET value=$1 WHERE key='payment_qr'",[data]);res.json({image:data});});

app.get('/api/admin/reports/summary',auth,adminOnly,async(req,res)=>{
  const {from,to}=req.query;
  const start=from?`${from} 00:00:00`:`${new Date().toISOString().slice(0,10)} 00:00:00`;
  const end=to?`${to} 23:59:59`:`${new Date().toISOString().slice(0,10)} 23:59:59`;
  const total=await q(`SELECT COALESCE(SUM(total),0)::int total,COUNT(*)::int orders,COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0)::int cash,COALESCE(SUM(CASE WHEN payment_method='transfer' THEN total ELSE 0 END),0)::int transfer FROM orders WHERE created_at BETWEEN $1 AND $2 AND status='paid'`,[start,end]);
  const byStaff=await q(`SELECT u.id,u.full_name AS "fullName",COUNT(o.id)::int orders,COALESCE(SUM(o.total),0)::int revenue FROM users u LEFT JOIN orders o ON o.user_id=u.id AND o.created_at BETWEEN $1 AND $2 AND o.status='paid' GROUP BY u.id ORDER BY revenue DESC`,[start,end]);
  const byDay=await q(`SELECT TO_CHAR(created_at,'YYYY-MM-DD') day,COUNT(*)::int orders,COALESCE(SUM(total),0)::int revenue FROM orders WHERE created_at BETWEEN $1 AND $2 AND status='paid' GROUP BY 1 ORDER BY 1`,[start,end]);
  res.json({summary:total.rows[0],byStaff:byStaff.rows,byDay:byDay.rows});
});
app.get('/api/admin/reports/shifts',auth,adminOnly,async(req,res)=>{const {from,to}=req.query;const start=from?`${from} 00:00:00`:'2000-01-01';const end=to?`${to} 23:59:59`:'2100-01-01';const r=await q(`SELECT s.id,s.clock_in,s.clock_out,u.full_name AS "fullName",COUNT(o.id)::int orders,COALESCE(SUM(o.total),0)::int revenue FROM shifts s JOIN users u ON u.id=s.user_id LEFT JOIN orders o ON o.shift_id=s.id AND o.status='paid' WHERE s.clock_in BETWEEN $1 AND $2 GROUP BY s.id,u.full_name ORDER BY s.clock_in DESC`,[start,end]);res.json(r.rows);});

app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));

initDb().then(()=>app.listen(PORT,()=>console.log(`Mindset POS running on ${PORT}`))).catch(err=>{console.error(err);process.exit(1)});