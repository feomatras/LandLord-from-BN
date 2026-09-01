// Access control and session management
const queries = require('./queries');

async function getUserRole(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return null;
  const user = await queries.getUser(userId);
  return user;
}

function isTenant(user) {
  return user && user.role === 'tenant' && user.is_active;
}

function isAdmin(user) {
  return user && user.role === 'admin';
}

function isSuperAdmin(user) {
  return user && user.role === 'super_admin';
}

function isTenantAccessValid(user) {
  if (!user) return false;
  if (user.role !== 'tenant') return true;
  if (!user.is_active) return false;
  if (user.access_until) {
    return new Date(user.access_until) >= new Date(new Date().toISOString().split('T')[0]);
  }
  return true;
}

async function checkSubscriptionActive(adminUserId) {
  const sub = await queries.getSubscription(adminUserId);
  return queries.isSubscriptionActive(sub);
}

module.exports = {
  getUserRole,
  isTenant,
  isAdmin,
  isSuperAdmin,
  isTenantAccessValid,
  checkSubscriptionActive,
};
