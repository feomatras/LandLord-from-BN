// Utility functions for formatting, dates, and validation

function formatMoney(amount) {
  const n = Number(amount) || 0;
  const rub = Math.floor(Math.abs(n));
  const kop = Math.round((Math.abs(n) - rub) * 100);
  const sign = n < 0 ? '-' : '';
  return `${sign}${rub} руб. ${String(kop).padStart(2, '0')} коп.`;
}

function formatMoneyShort(amount) {
  const n = Number(amount) || 0;
  return `${n.toFixed(2)} руб.`;
}

function monthKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${m}.${y}`;
}

function prevMonthKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return monthKey(d);
}

function monthKeyToDate(mk) {
  const [m, y] = mk.split('.').map(Number);
  return new Date(y, m - 1, 1);
}

function isValidDateStr(str) {
  if (!str) return false;
  const d = new Date(str);
  return !isNaN(d.getTime()) && str.match(/^\d{4}-\d{2}-\d{2}$/) !== null;
}

function isCurrentOrFutureMonth(dateStr) {
  if (!isValidDateStr(dateStr)) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
  return d >= firstOfCurrent;
}

function isValidPositiveNumber(str) {
  if (str == null) return false;
  const n = parseFloat(str);
  return !isNaN(n) && n >= 0 && /^\d+([.,]\d+)?$/.test(String(str).trim());
}

function normalizeNumber(str) {
  return parseFloat(String(str).trim().replace(',', '.'));
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function generateToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

function escapeMarkdown(text) {
  if (text == null) return '';
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function formatDate(date) {
  if (!date) return 'бессрочно';
  const d = new Date(date);
  return d.toLocaleDateString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function toFirstDayOfMonth(dateStr) {
  const d = new Date(dateStr);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return first.toISOString().split('T')[0];
}
module.exports = {
  formatMoney,
  formatMoneyShort,
  monthKey,
  prevMonthKey,
  monthKeyToDate,
  isValidDateStr,
  isCurrentOrFutureMonth,
  isValidPositiveNumber,
  normalizeNumber,
  round2,
  generateToken,
  escapeMarkdown,
  formatDate,
};
