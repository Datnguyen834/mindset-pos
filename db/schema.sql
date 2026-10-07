CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','manager','staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  birth_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(40) UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'Khác',
  price INTEGER NOT NULL CHECK (price >= 0),
  image_path TEXT,
  image_data TEXT,
  image_blob BYTEA,
  image_mime TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS toppings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clock_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out TIMESTAMPTZ,
  opening_note TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  birth_date DATE,
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS member_rewards (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  earned_year INTEGER NOT NULL,
  tier_key VARCHAR(20) NOT NULL,
  tier_name VARCHAR(40) NOT NULL,
  reward_name VARCHAR(120) NOT NULL,
  reward_quantity INTEGER NOT NULL DEFAULT 1,
  remaining_quantity INTEGER NOT NULL DEFAULT 1,
  redeemed_at TIMESTAMPTZ,
  redeemed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id, earned_year)
);
CREATE INDEX IF NOT EXISTS idx_member_rewards_customer ON member_rewards(customer_id, earned_year);


CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  shift_id INTEGER REFERENCES shifts(id),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash','transfer')),
  order_type VARCHAR(20),
  table_number INTEGER,
  order_note VARCHAR(300) NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  automatic_discount INTEGER NOT NULL DEFAULT 0,
  points_discount INTEGER NOT NULL DEFAULT 0,
  points_used INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
  item_name VARCHAR(120) NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total INTEGER NOT NULL,
  sugar_percent INTEGER NOT NULL DEFAULT 100 CHECK (sugar_percent BETWEEN 0 AND 100),
  ice_percent INTEGER NOT NULL DEFAULT 100 CHECK (ice_percent BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS order_item_toppings (
  id SERIAL PRIMARY KEY,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  topping_id INTEGER REFERENCES toppings(id),
  topping_name VARCHAR(100) NOT NULL,
  topping_price INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1
);



CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(80) PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_user_id ON shifts(user_id);


-- Safe migration for existing Render/PostgreSQL databases.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sugar_percent INTEGER NOT NULL DEFAULT 100;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS ice_percent INTEGER NOT NULL DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE member_rewards ADD COLUMN IF NOT EXISTS reward_quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE member_rewards ADD COLUMN IF NOT EXISTS remaining_quantity INTEGER NOT NULL DEFAULT 1;

-- Hard-delete users while preserving historical orders. Deleted users leave their
-- orders in the database with a NULL user_id instead of blocking account deletion.
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_note VARCHAR(300) NOT NULL DEFAULT '';
UPDATE orders SET order_type='dine_in' WHERE order_type IS NULL;
UPDATE orders SET order_note='' WHERE order_note IS NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS automatic_discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS member_reward_id INTEGER REFERENCES member_rewards(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS member_reward_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS member_reward_discount INTEGER NOT NULL DEFAULT 0;


-- payOS automatic transfer confirmation metadata
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_order_code BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_order_code ON orders(payment_order_code) WHERE payment_order_code IS NOT NULL;


CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);
