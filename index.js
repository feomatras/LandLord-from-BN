// Main entry point for the Telegram rental bot
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const config = require('./src/config');
const queries = require('./src/queries');
const auth = require('./src/auth');
const keyboards = require('./src/keyboards');
const session = require('./src/session');
const { formatMoney } = require('./src/utils');

const adminCmd = require('./src/commands/admin');
const tenantCmd = require('./src/commands/tenant');
const superCmd = require('./src/commands/superadmin');
const { setupScheduler } = require('./src/scheduler');
const { initSchema } = require('./src/schema');

if (!config.BOT_TOKEN) {
  console.error('BOT_TOKEN is required. Set it in .env');
  process.exit(1);
}

if (!config.SETUP_KEY) {
  console.error('SETUP_KEY is required. Set it in .env');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// ---- /start command ----
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const payload = ctx.startPayload || '';

  // Check if this is an invite link
  if (payload) {
    return handleInvite(ctx, payload);
  }

  // Check if user is registered
  const user = await queries.getUser(userId);
  if (!user) {
    // Check if this is the first-run super-admin setup
    const state = await queries.initBotState(config.SETUP_KEY);
    if (!state.setup_complete) {
      // First-time setup: prompt for the setup key
      if (payload === state.setup_key) {
        await queries.createUser(userId, 'super_admin');
        await queries.setSuperAdmin(userId);
        return ctx.reply(
          '✅ Вы назначены суперадминистратором! Используйте /help для списка команд.',
          keyboards.adminMainMenu()
        );
      }
      session.setSession(userId, { flow: 'setup_key' });
      return ctx.reply(
        '🔧 Бот не настроен. Вы первый пользователь.\nВведите ключ настройки для получения прав суперадминистратора:',
        keyboards.removeKeyboard()
      );
    }
    return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  }

  // Route by role
  if (user.role === 'super_admin') return superCmd.superAdminStart(ctx, user);
  if (user.role === 'admin') return adminCmd.adminStart(ctx, user);
  if (user.role === 'tenant') {
    if (!auth.isTenantAccessValid(user)) {
      return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
    }
    return tenantCmd.tenantStart(ctx, user);
  }
  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

// ---- Invite handling ----
async function handleInvite(ctx, tokenStr) {
  const userId = ctx.from.id;
  const token = await queries.getInviteToken(tokenStr);

  if (!token || token.used) {
    return ctx.reply('Ссылка недействительна или уже использована. По всем вопросам обращаться @Cheatgtp');
  }
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return ctx.reply('Срок действия ссылки истёк. По всем вопросам обращаться @Cheatgtp');
  }

  const existing = await queries.getUser(userId);
  if (existing) {
    return ctx.reply('Вы уже зарегистрированы в системе. Используйте /start.');
  }

  if (token.role === 'admin') {
    await queries.createUser(userId, 'admin');
    await queries.markTokenUsed(token.id);
    await ctx.reply(
      '✅ Вы зарегистрированы как арендодатель! Используйте /start для начала работы.',
      keyboards.adminMainMenu()
    );
    // Notify super admin
    const state = await queries.getBotState();
    if (state?.super_admin_user_id) {
      try {
        await ctx.telegram.sendMessage(
          state.super_admin_user_id,
          `🔔 Новый арендодатель зарегистрирован: ${userId}\nИспользуйте /manage_subscription для настройки подписки.`
        );
      } catch (e) { /* ignore */ }
    }
  } else if (token.role === 'tenant') {
    await queries.createUser(userId, 'tenant', token.flat_id, token.access_until);
    await queries.markTokenUsed(token.id);
    await ctx.reply('✅ Вы зарегистрированы как арендатор! Используйте /start для начала работы.');
    // Notify landlord
    const flat = await queries.getFlat(token.flat_id);
    if (flat?.admin_user_id) {
      try {
        await ctx.telegram.sendMessage(
          flat.admin_user_id,
          `🔔 Новый арендатор зарегистрирован: ${userId}\nКвартира: ${flat.name}`
        );
      } catch (e) { /* ignore */ }
    }
  }
}

// ---- /help ----
bot.help(async (ctx) => {
  const user = await queries.getUser(ctx.from.id);
  if (!user) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.superAdminHelp(ctx);
  if (user.role === 'admin') return adminCmd.adminHelp(ctx);
  if (user.role === 'tenant') return tenantCmd.tenantHelp(ctx);
  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

// ---- Middleware: check registration and subscription ----
async function getCtxUser(ctx) {
  return await queries.getUser(ctx.from.id);
}

async function isExpiredForAdmin(user) {
  if (user.role !== 'admin') return false;
  return !(await auth.checkSubscriptionActive(user.user_id));
}

// ---- Admin commands ----
bot.command('addflat', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.addFlat(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.addFlat(ctx, user);
});

bot.command('select_flat', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.selectFlat(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.selectFlat(ctx, user);
});

bot.command('flats', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.listFlats(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.listFlats(ctx, user);
});

bot.command('deleteflat', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.deleteFlatCmd(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.deleteFlatCmd(ctx, user);
});

bot.command('history', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.history(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.history(ctx, user);
});

bot.command('stats', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.superAdminStats(ctx, user);
  if (user.role === 'admin') {
    if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
    return adminCmd.stats(ctx, user);
  }
  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

bot.command('invite_tenant', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.inviteTenant(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.inviteTenant(ctx, user);
});

bot.command('removeuser', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'admin' && await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.removeUser(ctx, user);
});

bot.command('listusers', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'admin' && await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.listUsers(ctx, user);
});

bot.command('subscribe', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await adminCmd.subscribeInfo(ctx, user);
});

bot.command('toggle_rent', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.toggleRent(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.toggleRent(ctx, user);
});

bot.command('set_rent', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.setRent(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.setRent(ctx, user);
});

bot.command('pay', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.pay(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.pay(ctx, user);
});

bot.command('set_initial_readings', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.setInitialReadings(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.setInitialReadings(ctx, user);
});

bot.command('summary', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.summary(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Подписка истекла. /contact_superadmin');
  await adminCmd.summary(ctx, user);
});

bot.command('contact_superadmin', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await adminCmd.contactSuperAdmin(ctx, user);
});

// ---- Tenant commands ----
bot.command('balance', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (!auth.isTenantAccessValid(user)) return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
  await tenantCmd.tenantBalance(ctx, user);
});

bot.command('submit', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (!auth.isTenantAccessValid(user)) return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
  await tenantCmd.submitReadings(ctx, user, bot);
});

// ---- Super admin commands ----
bot.command('add_admin', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.addAdmin(ctx, user);
});

bot.command('invite_admin', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.inviteAdmin(ctx, user);
});

bot.command('list_admins', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.listAdmins(ctx, user);
});

bot.command('manage_subscription', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.manageSubscription(ctx, user);
});

bot.command('backup', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await ctx.reply('Резервное копирование выполняется автоматически каждый день в 2:00. Для ручного запуска используйте скрипт scripts/backup.js на сервере.');
});

// ---- Callback query handlers ----
bot.action('confirm_reading', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.answerCbQuery('Ошибка');
  await tenantCmd.confirmReading(ctx, user, bot);
});

bot.action('retry_reading', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.answerCbQuery('Ошибка');
  await tenantCmd.retryReading(ctx, user);
});

bot.action('pay_action', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.answerCbQuery('Ошибка');
  await ctx.answerCbQuery();
  if (user.role === 'super_admin') return superCmd.pay(ctx, user);
  await adminCmd.pay(ctx, user);
});

bot.action(/select_flat_(\d+)/, async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.answerCbQuery('Ошибка');
  const flatId = parseInt(ctx.match[1]);
  const flat = await queries.getFlat(flatId);
  if (!flat || flat.admin_user_id !== user.user_id) return ctx.answerCbQuery('Квартира не найдена');
  if (user.role === 'super_admin') {
    await queries.setSelectedFlat(user.user_id, flatId);
    const balance = await queries.getBalance(flatId);
    await ctx.answerCbQuery(`Квартира ${flat.name} выбрана`);
    return ctx.reply(`Активная квартира: ${flat.id}. ${flat.name}\nТекущий баланс: ${formatMoney(balance)}`, keyboards.adminMainMenu());
  }
  await queries.setSelectedFlat(user.user_id, flatId);
  const balance = await queries.getBalance(flatId);
  await ctx.answerCbQuery(`Квартира ${flat.name} выбрана`);
  await ctx.reply(`Активная квартира: ${flat.id}. ${flat.name}\nТекущий баланс: ${formatMoney(balance)}`, keyboards.adminMainMenu());
});

// ---- Menu button handlers ----
const tariffButtons = {
  'Изменить тариф Воды': 'water',
  'Изменить тариф Электричества': 'electricity',
  'Изменить тариф Газа': 'gas',
  'Изменить тариф ТКО': 'tko',
  'Изменить тариф УК': 'uk',
  'Изменить Капремонт': 'caprepair',
};

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;
  const user = await getCtxUser(ctx);

  // Handle first-run setup key flow (user is not yet registered)
  if (!user) {
    const sess = session.getSession(userId);
    if (sess && sess.flow === 'setup_key') {
      const state = await queries.getBotState();
      if (text === state.setup_key) {
        await queries.createUser(userId, 'super_admin');
        await queries.setSuperAdmin(userId);
        session.clearSession(userId);
        return ctx.reply(
          '✅ Вы назначены суперадминистратором! Используйте /help для списка команд.',
          keyboards.adminMainMenu()
        );
      }
      return ctx.reply('❌ Неверный ключ. Введите ключ настройки:');
    }
    return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  }

  // Check active session first
  const sess = session.getSession(user.user_id);
  if (sess) {
    if (sess.flow === 'payment' && (user.role === 'admin' || user.role === 'super_admin')) {
      if (user.role === 'super_admin') return superCmd.handlePaymentInput(ctx, user);
      return adminCmd.handlePaymentInput(ctx, user);
    }
    if (sess.flow === 'contact_superadmin' && user.role === 'admin') {
      return adminCmd.handleContactInput(ctx, user, bot);
    }
    if (sess.flow === 'tariff_change' && (user.role === 'admin' || user.role === 'super_admin')) {
      if (user.role === 'super_admin') {
        if (sess.step === 'tariff_date') return superCmd.handleTariffDate(ctx, user);
        return superCmd.handleTariffInput(ctx, user);
      }
      if (sess.step === 'tariff_date') return adminCmd.handleTariffDate(ctx, user);
      return adminCmd.handleTariffInput(ctx, user);
    }
    if (sess.flow === 'meter_readings' && user.role === 'tenant') {
      return tenantCmd.handleReadingInput(ctx, user);
    }
    if (sess.flow === 'add_admin' && user.role === 'super_admin') {
      return superCmd.handleAddAdminInput(ctx, user, bot);
    }
  }

  // Menu buttons
  if (text === 'Главное меню') {
    if (user.role === 'admin') return adminCmd.adminStart(ctx, user);
    if (user.role === 'super_admin') return superCmd.superAdminStart(ctx, user);
  }

  if (user.role === 'super_admin') {
    if (text === 'Настройка аренды') {
      const flat = await queries.getFlat(user.selected_flat_id);
      if (!flat) return ctx.reply('Выберите квартиру.');
      let msg = `Учёт аренды: ${flat.rent_enabled ? 'включён' : 'выключен'}\n`;
      msg += `Сумма: ${flat.rent_amount || 0} руб.\n\n`;
      msg += `Команды:\n/toggle_rent — включить/выключить\n/set_rent <сумма> — установить сумму`;
      return ctx.reply(msg);
    }
    if (text === 'Внести платеж') return superCmd.pay(ctx, user);
    if (text === 'Мои квартиры') return superCmd.listFlats(ctx, user);
    if (text === 'История платежей') return superCmd.history(ctx, user);
    if (tariffButtons[text]) {
      return superCmd.handleTariffChange(ctx, user, tariffButtons[text]);
    }
    return;
  }

  if (user.role === 'admin' && !(await isExpiredForAdmin(user))) {
    if (text === 'Настройка аренды') {
      const flat = await queries.getFlat(user.selected_flat_id);
      if (!flat) return ctx.reply('Выберите квартиру.');
      let msg = `Учёт аренды: ${flat.rent_enabled ? 'включён' : 'выключен'}\n`;
      msg += `Сумма: ${flat.rent_amount || 0} руб.\n\n`;
      msg += `Команды:\n/toggle_rent — включить/выключить\n/set_rent <сумма> — установить сумму`;
      return ctx.reply(msg);
    }
    if (text === 'Внести платеж') return adminCmd.pay(ctx, user);
    if (text === 'Мои квартиры') return adminCmd.listFlats(ctx, user);
    if (text === 'История платежей') return adminCmd.history(ctx, user);
    if (tariffButtons[text]) {
      return adminCmd.handleTariffChange(ctx, user, tariffButtons[text]);
    }
  }

  // If nothing matched and user is admin/super_admin, show menu
  if (user.role === 'admin' || user.role === 'super_admin') {
    // Ignore unrecognized text in menu mode
    return;
  }

  // Tenant unrecognized
  if (user.role === 'tenant') {
    return;
  }

  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

// ---- Error handling ----
bot.catch((err, ctx) => {
  console.error('[Bot Error]', err.message);
  if (ctx && ctx.reply) {
    ctx.reply('Произошла ошибка. Попробуйте позже.').catch(() => {});
  }
});

// ---- Start ----
async function start() {
  await initSchema();
  await queries.initBotState(config.SETUP_KEY);
  setupScheduler(bot);
  await bot.launch();
  console.log('[Bot] Started successfully');
}

start();

process.on('SIGINT', () => bot.stop('SIGINT'));
process.on('SIGTERM', () => bot.stop('SIGTERM'));
