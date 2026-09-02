// Data access layer: all database queries via better-sqlite3
const { query, queryOne, queryAll } = require('./db');
const { prevMonthKey, generateToken } = require('./utils');

// ---- Users ----
async function getUser(userId) {
  return queryOne('SELECT * FROM users WHERE user_id = ?', [userId]);
}

async function createUser(userId, role, flatId = null, accessUntil = null) {
  return queryOne(
    `INSERT INTO users (user_id, role, flat_id, access_until, is_active)
     VALUES (?, ?, ?, ?, 1) RETURNING *`,
    [userId, role, flatId, accessUntil]
  );
}

async function deactivateUser(userId) {
  await query('UPDATE users SET is_active = 0 WHERE user_id = ?', [userId]);
}

async function reactivateTenant(userId, flatId, accessUntil) {
  return queryOne(
    `UPDATE users SET role = 'tenant', flat_id = ?, access_until = ?, is_active = 1
     WHERE user_id = ? RETURNING *`,
    [flatId, accessUntil, userId]
  );
}

async function setSelectedFlat(userId, flatId) {
  await query('UPDATE users SET selected_flat_id = ? WHERE user_id = ?', [flatId, userId]);
}

async function listUsersForAdmin(adminUserId) {
  return queryAll(
    `SELECT u.user_id, u.role, u.flat_id, u.is_active, u.access_until
     FROM users u
     JOIN flats f ON u.flat_id = f.id
     WHERE f.admin_user_id = ? AND u.role = 'tenant'
     ORDER BY u.user_id`,
    [adminUserId]
  );
}

async function listAllUsers() {
  return queryAll('SELECT * FROM users ORDER BY created_at DESC');
}

// ---- Bot State ----
async function getBotState() {
  return queryOne('SELECT * FROM bot_state WHERE id = 1');
}

async function initBotState(setupKey) {
  const existing = await getBotState();
  if (existing) return existing;
  return queryOne(
    'INSERT INTO bot_state (id, setup_key, setup_complete) VALUES (1, ?, 0) RETURNING *',
    [setupKey]
  );
}

async function setSuperAdmin(userId) {
  await query(
    'UPDATE bot_state SET super_admin_user_id = ?, setup_complete = 1 WHERE id = 1',
    [userId]
  );
}

// ---- Flats ----
async function getFlat(flatId) {
  return queryOne('SELECT * FROM flats WHERE id = ?', [flatId]);
}

async function listFlatsForAdmin(adminUserId) {
  return queryAll('SELECT * FROM flats WHERE admin_user_id = ? ORDER BY id ASC', [adminUserId]);
}

async function countFlatsForAdmin(adminUserId) {
  const row = await queryOne('SELECT COUNT(*) AS count FROM flats WHERE admin_user_id = ?', [adminUserId]);
  return row ? row.count : 0;
}

async function createFlat(name, adminUserId) {
  return queryOne(
    'INSERT INTO flats (name, admin_user_id) VALUES (?, ?) RETURNING *',
    [name, adminUserId]
  );
}

async function deleteFlat(flatId) {
  await query('DELETE FROM flats WHERE id = ?', [flatId]);
}

async function setRent(flatId, enabled, amount = 0) {
  await query(
    'UPDATE flats SET rent_enabled = ?, rent_amount = ? WHERE id = ?',
    [enabled ? 1 : 0, amount, flatId]
  );
}

// ---- Tariffs ----
async function getCurrentTariff(flatId, date = new Date()) {
  const isoDate = date.toISOString().split('T')[0];
  return queryOne(
    `SELECT * FROM tariff_history
     WHERE flat_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [flatId, isoDate]
  );
}

async function getTariffForMonth(flatId, monthKeyStr) {
  const [m, y] = monthKeyStr.split('.').map(Number);
  const monthDate = new Date(y, m - 1, 1);
  const isoDate = monthDate.toISOString().split('T')[0];
  return queryOne(
    `SELECT * FROM tariff_history
     WHERE flat_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [flatId, isoDate]
  );
}

async function createTariffRecord(flatId, tariffData, effectiveFrom) {
  return queryOne(
    `INSERT INTO tariff_history
     (flat_id, water, electricity_threshold1, electricity_tariff1,
      electricity_threshold2, electricity_tariff2, electricity_tariff3,
      gas, tko, uk, caprepair, effective_from)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      flatId,
      tariffData.water || 0,
      tariffData.electricity_threshold1 || 150,
      tariffData.electricity_tariff1 || 0,
      tariffData.electricity_threshold2 || 800,
      tariffData.electricity_tariff2 || 0,
      tariffData.electricity_tariff3 || 0,
      tariffData.gas || 0,
      tariffData.tko || 0,
      tariffData.uk || 0,
      tariffData.caprepair || 0,
      effectiveFrom,
    ]
  );
}

async function createDefaultTariff(flatId) {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDayStr = firstDay.toISOString().split('T')[0];
  return createTariffRecord(flatId, {}, firstDayStr);
}

// ---- Meter Readings ----
async function getReadings(flatId, mk) {
  return queryOne('SELECT * FROM meter_readings WHERE flat_id = ? AND month = ?', [flatId, mk]);
}

async function getLatestReadings(flatId) {
  return queryOne(
    'SELECT * FROM meter_readings WHERE flat_id = ? ORDER BY month DESC LIMIT 1',
    [flatId]
  );
}

async function upsertReadings(flatId, mk, readings, prevReadings) {
  const existing = await getReadings(flatId, mk);
  const nowIso = new Date().toISOString();
  if (existing) {
    return queryOne(
      `UPDATE meter_readings SET
        electricity = ?, water = ?, gas = ?,
        previous_electricity = ?, previous_water = ?, previous_gas = ?,
        updated_at = ?
       WHERE id = ? RETURNING *`,
      [
        readings.electricity, readings.water, readings.gas,
        prevReadings.electricity, prevReadings.water, prevReadings.gas,
        nowIso, existing.id,
      ]
    );
  }
  return queryOne(
    `INSERT INTO meter_readings
     (flat_id, month, electricity, water, gas, previous_electricity, previous_water, previous_gas, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      flatId, mk, readings.electricity, readings.water, readings.gas,
      prevReadings.electricity, prevReadings.water, prevReadings.gas, nowIso,
    ]
  );
}

async function setInitialReadings(flatId, electricity, water, gas) {
  const pmk = prevMonthKey();
  const existing = await getReadings(flatId, pmk);
  const nowIso = new Date().toISOString();
  if (existing) {
    return queryOne(
      `UPDATE meter_readings SET
        electricity = ?, water = ?, gas = ?,
        previous_electricity = ?, previous_water = ?, previous_gas = ?,
        updated_at = ?
       WHERE id = ? RETURNING *`,
      [electricity, water, gas, electricity, water, gas, nowIso, existing.id]
    );
  }
  return queryOne(
    `INSERT INTO meter_readings
     (flat_id, month, electricity, water, gas, previous_electricity, previous_water, previous_gas, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`,
    [flatId, pmk, electricity, water, gas, electricity, water, gas, nowIso]
  );
}

// ---- Transactions ----
async function getTransactions(flatId, limit = 50) {
  return queryAll(
    'SELECT * FROM transactions WHERE flat_id = ? ORDER BY created_at DESC LIMIT ?',
    [flatId, limit]
  );
}

async function getTransactionsForUser(userId) {
  const user = await queryOne('SELECT flat_id FROM users WHERE user_id = ?', [userId]);
  if (!user || !user.flat_id) return [];
  return getTransactions(user.flat_id);
}

async function getAccrualForMonth(flatId, mk) {
  return queryOne(
    `SELECT * FROM transactions WHERE flat_id = ? AND month = ? AND type = 'accrual'`,
    [flatId, mk]
  );
}

async function createAccrual(flatId, mk, amount, description, tariffsSnapshot, createdBy) {
  return queryOne(
    `INSERT INTO transactions (flat_id, month, amount, type, description, tariffs_snapshot, created_by)
     VALUES (?, ?, ?, 'accrual', ?, ?, ?) RETURNING *`,
    [flatId, mk, amount, description, JSON.stringify(tariffsSnapshot), createdBy]
  );
}

async function deleteAccrual(flatId, mk) {
  await query(
    `DELETE FROM transactions WHERE flat_id = ? AND month = ? AND type = 'accrual'`,
    [flatId, mk]
  );
}

async function createPayment(flatId, mk, amount, createdBy) {
  const payAmount = -Math.abs(Number(amount));
  return queryOne(
    `INSERT INTO transactions (flat_id, month, amount, type, description, created_by)
     VALUES (?, ?, ?, 'payment', 'Платёж от арендатора', ?) RETURNING *`,
    [flatId, mk, payAmount, createdBy]
  );
}

async function getBalance(flatId) {
  const row = await queryOne(
    'SELECT COALESCE(SUM(amount), 0) AS balance FROM transactions WHERE flat_id = ?',
    [flatId]
  );
  return row ? Math.round(row.balance * 100) / 100 : 0;
}

// ---- Subscriptions ----
async function getSubscription(adminUserId) {
  return queryOne('SELECT * FROM subscriptions WHERE admin_user_id = ?', [adminUserId]);
}

async function createSubscription(adminUserId, endDate, maxFlats) {
  const deletionDate = new Date(endDate);
  deletionDate.setMonth(deletionDate.getMonth() + 3);
  return queryOne(
    `INSERT INTO subscriptions (admin_user_id, end_date, max_flats, deletion_scheduled_at)
     VALUES (?, ?, ?, ?) RETURNING *`,
    [adminUserId, endDate, maxFlats, deletionDate.toISOString().split('T')[0]]
  );
}

async function updateSubscription(adminUserId, endDate, maxFlats) {
  const deletionDate = new Date(endDate);
  deletionDate.setMonth(deletionDate.getMonth() + 3);
  return queryOne(
    `UPDATE subscriptions SET end_date = ?, max_flats = ?, deletion_scheduled_at = ?
     WHERE admin_user_id = ? RETURNING *`,
    [endDate, maxFlats, deletionDate.toISOString().split('T')[0], adminUserId]
  );
}

async function listAllSubscriptions() {
  return queryAll(
    `SELECT s.*, u.user_id FROM subscriptions s
     JOIN users u ON s.admin_user_id = u.user_id
     ORDER BY s.created_at DESC`
  );
}

function isSubscriptionActive(sub) {
  if (!sub) return false;
  return new Date(sub.end_date) >= new Date();
}

// ---- Invite Tokens ----
async function createInviteToken(role, flatId = null, accessUntil = null) {
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return queryOne(
    `INSERT INTO invite_tokens (token, role, flat_id, expires_at, access_until)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [token, role, flatId, expiresAt.toISOString(), accessUntil]
  );
}

async function getInviteToken(token) {
  return queryOne('SELECT * FROM invite_tokens WHERE token = ?', [token]);
}

async function markTokenUsed(tokenId) {
  await query('UPDATE invite_tokens SET used = 1 WHERE id = ?', [tokenId]);
}

// ---- Tenants ----
async function getTenantsForFlat(flatId) {
  return queryAll(
    `SELECT * FROM users WHERE flat_id = ? AND role = 'tenant' AND is_active = 1`,
    [flatId]
  );
}

async function getAllActiveTenants() {
  return queryAll(
    `SELECT user_id, flat_id, access_until, is_active, role FROM users
     WHERE role = 'tenant' AND is_active = 1`
  );
}

async function getAllFlats() {
  return queryAll('SELECT * FROM flats');
}

// ---- Stats ----
async function getGlobalStats() {
  const adminRow = await queryOne(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`);
  const flatRow = await queryOne(`SELECT COUNT(*) AS count FROM flats`);
  const today = new Date().toISOString().split('T')[0];
  const subRow = await queryOne(
    `SELECT COUNT(*) AS count FROM subscriptions WHERE end_date >= ?`,
    [today]
  );
  const debtRow = await queryOne(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'accrual'`
  );
  return {
    adminCount: adminRow ? adminRow.count : 0,
    flatCount: flatRow ? flatRow.count : 0,
    activeSubs: subRow ? subRow.count : 0,
    totalDebt: debtRow ? Math.round(debtRow.total * 100) / 100 : 0,
  };
}

// ---- Cleanup ----
async function deleteUserAndData(userId) {
  const flats = await listFlatsForAdmin(userId);
  for (const flat of flats) {
    await deleteFlat(flat.id);
  }
  await query('DELETE FROM subscriptions WHERE admin_user_id = ?', [userId]);
  await query('DELETE FROM users WHERE user_id = ?', [userId]);
}

module.exports = {
  getUser,
  createUser,
  deactivateUser,
  reactivateTenant,
  setSelectedFlat,
  listUsersForAdmin,
  listAllUsers,
  getBotState,
  initBotState,
  setSuperAdmin,
  getFlat,
  listFlatsForAdmin,
  countFlatsForAdmin,
  createFlat,
  deleteFlat,
  setRent,
  getCurrentTariff,
  getTariffForMonth,
  createTariffRecord,
  createDefaultTariff,
  getReadings,
  getLatestReadings,
  upsertReadings,
  setInitialReadings,
  getTransactions,
  getTransactionsForUser,
  getAccrualForMonth,
  createAccrual,
  deleteAccrual,
  createPayment,
  getBalance,
  getSubscription,
  createSubscription,
  updateSubscription,
  listAllSubscriptions,
  isSubscriptionActive,
  createInviteToken,
  getInviteToken,
  markTokenUsed,
  getTenantsForFlat,
  getAllActiveTenants,
  getAllFlats,
  getGlobalStats,
  deleteUserAndData,
};
