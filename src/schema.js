// Auto-initializes the database schema on startup (idempotent — safe to re-run).
const { db } = require('./db');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS flats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rent_enabled INTEGER NOT NULL DEFAULT 0,
  rent_amount NUMERIC NOT NULL DEFAULT 0,
  admin_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'tenant',
  flat_id INTEGER REFERENCES flats(id) ON DELETE SET NULL,
  selected_flat_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  access_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tariff_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flat_id INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  water NUMERIC NOT NULL DEFAULT 0,
  electricity_threshold1 NUMERIC NOT NULL DEFAULT 150,
  electricity_tariff1 NUMERIC NOT NULL DEFAULT 0,
  electricity_threshold2 NUMERIC NOT NULL DEFAULT 800,
  electricity_tariff2 NUMERIC NOT NULL DEFAULT 0,
  electricity_tariff3 NUMERIC NOT NULL DEFAULT 0,
  gas NUMERIC NOT NULL DEFAULT 0,
  tko NUMERIC NOT NULL DEFAULT 0,
  uk NUMERIC NOT NULL DEFAULT 0,
  caprepair NUMERIC NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meter_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flat_id INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  electricity NUMERIC,
  water NUMERIC,
  gas NUMERIC,
  previous_electricity NUMERIC,
  previous_water NUMERIC,
  previous_gas NUMERIC,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flat_id INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  tariffs_snapshot TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  end_date TEXT NOT NULL,
  max_flats INTEGER NOT NULL DEFAULT 1,
  deletion_scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invite_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  flat_id INTEGER REFERENCES flats(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  access_until TEXT
);

CREATE TABLE IF NOT EXISTS bot_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  super_admin_user_id INTEGER,
  setup_key TEXT,
  setup_complete INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_flats_admin ON flats(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_users_flat ON users(flat_id);
CREATE INDEX IF NOT EXISTS idx_tariff_flat ON tariff_history(flat_id);
CREATE INDEX IF NOT EXISTS idx_tariff_effective ON tariff_history(effective_from);
CREATE INDEX IF NOT EXISTS idx_readings_flat_month ON meter_readings(flat_id, month);
CREATE INDEX IF NOT EXISTS idx_txn_flat_month ON transactions(flat_id, month);
CREATE INDEX IF NOT EXISTS idx_sub_admin ON subscriptions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_invite_token ON invite_tokens(token);
`;

async function initSchema() {
  db.exec(SCHEMA_SQL);
  console.log('[DB] Schema initialized');
}

module.exports = { initSchema };
