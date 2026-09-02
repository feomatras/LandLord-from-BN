// Super-admin command handlers
const queries = require('../queries');
const {
  formatMoney,
  formatMoneyShort,
  monthKey,
  isValidDateStr,
  isCurrentOrFutureMonth,
  normalizeNumber,
  round2,
  formatDate,
  toFirstDayOfMonth,
} = require('../utils');
const keyboards = require('../keyboards');
const session = require('../session');
const config = require('../config');
const adminCmd = require('./admin');

async function superAdminStart(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  let selectedFlat = null;
  if (user.selected_flat_id) {
    selectedFlat = await queries.getFlat(user.selected_flat_id);
  }
  if (!selectedFlat && flats.length > 0) {
    selectedFlat = flats[0];
    await queries.setSelectedFlat(user.user_id, selectedFlat.id);
  }

  let msg = `Здравствуйте, суперадминистратор!\n\n`;
  msg += `Активная квартира: ${selectedFlat ? `${selectedFlat.id}. ${selectedFlat.name}` : 'не выбрана'}\n`;
  msg += `Всего квартир: ${flats.length}\n\n`;
  msg += `Управление квартирами (без ограничений):\n`;
  msg += `/addflat <название> — создать квартиру\n`;
  msg += `/select_flat <номер> — выбрать квартиру\n`;
  msg += `/flats — список квартир\n`;
  msg += `/deleteflat <номер> — удалить квартиру\n`;
  msg += `/history — история транзакций\n`;
  msg += `/stats — тарифы и показания\n`;
  msg += `/summary — сводка по квартирам\n`;
  msg += `/invite_tenant — пригласить арендатора\n`;
  msg += `/listusers — список пользователей\n`;
  msg += `/removeuser <ID> — удалить пользователя\n`;
  msg += `/toggle_rent — включить/выключить аренду\n`;
  msg += `/set_rent <сумма> — установить аренду\n`;
  msg += `/pay — внести платёж\n`;
  msg += `/set_initial_readings <эл> <вода> <газ> — начальные показания\n\n`;
  msg += `Управление арендодателями:\n`;
  msg += `/add_admin — добавить арендодателя вручную\n`;
  msg += `/invite_admin — ссылка-приглашение для арендодателя\n`;
  msg += `/list_admins — список арендодателей\n`;
  msg += `/manage_subscription <user_id> <end_date> <max_flats> — управление подпиской\n\n`;
  msg += `/stats — общая статистика\n`;
  msg += `/backup — резервная копия БД\n`;
  msg += `/help — подробная инструкция`;
  await ctx.reply(msg, keyboards.adminMainMenu());
}

async function superAdminHelp(ctx) {
  let msg = `📋 Инструкция для суперадминистратора

🏠 Квартиры (без ограничений подписки):
• /addflat <название> — создать квартиру
• /select_flat <номер> — выбрать активную квартиру
• /flats — список квартир с балансами
• /deleteflat <номер> — удалить квартиру (без проверки сальдо)

⚙️ Тарифы (через кнопки меню):
• Изменение тарифа требует дату начала действия (ГГГГ-ММ-ДД)
• Если тариф = 0, показания не запрашиваются
• Электричество: 5 чисел (порог1 тариф1 порог2 тариф2 тариф3) или одно число

📊 Показания и расчёты:
• /set_initial_readings <эл> <вода> <газ> — начальные показания
• /stats — текущие тарифы и показания
• /summary — сводка по квартирам и общая статистика
• /history — история начислений и платежей

👥 Арендаторы:
• /invite_tenant — ссылка-приглашение
• /listusers — список пользователей
• /removeuser <TelegramID> — удалить пользователя

💰 Платежи:
• /pay — внести платёж
• /toggle_rent — включить/выключить аренду
• /set_rent <сумма> — установить сумму аренды

🏢 Арендодатели:
• /add_admin — добавить вручную
• /invite_admin — ссылка-приглашение
• /list_admins — список с подписками
• /manage_subscription <user_id> <ГГГГ-ММ-ДД> <max_flats> — управление

📊 /stats — общая статистика
💾 /backup — резервная копия`;
  await ctx.reply(msg);
}

// ---- Flat management (unrestricted) ----

async function addFlat(ctx, user) {
  const name = ctx.message.text.replace(/^\/addflat\s*/i, '').trim();
  if (!name) {
    return ctx.reply('Укажите название квартиры: /addflat <название>');
  }
  const flat = await queries.createFlat(name, user.user_id);
  await queries.createDefaultTariff(flat.id);
  await queries.setSelectedFlat(user.user_id, flat.id);
  await ctx.reply(`✅ Квартира «${name}» создана (№${flat.id}). Она выбрана как активная.`, keyboards.adminMainMenu());
}

async function selectFlat(ctx, user) {
  const arg = ctx.message.text.replace(/^\/select_flat\s*/i, '').trim();
  if (!arg) {
    const flats = await queries.listFlatsForAdmin(user.user_id);
    if (!flats.length) return ctx.reply('У вас нет квартир.');
    const list = flats.map(f => `${f.id}. ${f.name}`).join('\n');
    return ctx.reply(`Выберите квартиру:\n${list}\n\nИспользуйте /select_flat <номер>`, keyboards.flatListKeyboard(flats));
  }
  const flatId = parseInt(arg);
  const flat = await queries.getFlat(flatId);
  if (!flat || flat.admin_user_id !== user.user_id) {
    return ctx.reply('Квартира не найдена.');
  }
  await queries.setSelectedFlat(user.user_id, flatId);
  const balance = await queries.getBalance(flatId);
  await ctx.reply(`Активная квартира: ${flat.id}. ${flat.name}\nТекущий баланс: ${formatMoney(balance)}`, keyboards.adminMainMenu());
}

async function listFlats(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  if (!flats.length) return ctx.reply('У вас нет квартир.');
  let msg = `Ваши квартиры:\n\n`;
  for (const f of flats) {
    const balance = await queries.getBalance(f.id);
    const balStr = balance > 0 ? `долг ${formatMoneyShort(balance)}` : balance < 0 ? `переплата ${formatMoneyShort(Math.abs(balance))}` : `0`;
    msg += `${f.id}. ${f.name} — ${balStr}\n`;
  }
  await ctx.reply(msg);
}

async function deleteFlatCmd(ctx, user) {
  const arg = ctx.message.text.replace(/^\/deleteflat\s*/i, '').trim();
  if (!arg) return ctx.reply('Укажите номер квартиры: /deleteflat <номер>');
  const flatId = parseInt(arg);
  const flat = await queries.getFlat(flatId);
  if (!flat || flat.admin_user_id !== user.user_id) {
    return ctx.reply('Квартира не найдена.');
  }
  const balance = await queries.getBalance(flatId);
  if (Math.abs(balance) > 0.001) {
    await ctx.reply(`⚠️ Внимание: сальдо по квартире не равно нулю (${formatMoney(balance)}). Удаление всё равно будет выполнено.`);
  }
  await queries.deleteFlat(flatId);
  await ctx.reply(`✅ Квартира «${flat.name}» удалена вместе со всеми данными.`, keyboards.adminMainMenu());
}

async function history(ctx, user) {
  return adminCmd.history(ctx, user);
}

async function stats(ctx, user) {
  return adminCmd.stats(ctx, user);
}

async function inviteTenant(ctx, user) {
  return adminCmd.inviteTenant(ctx, user);
}

async function removeUser(ctx, user) {
  return adminCmd.removeUser(ctx, user);
}

async function listUsers(ctx, user) {
  return adminCmd.listUsers(ctx, user);
}

async function toggleRent(ctx, user) {
  return adminCmd.toggleRent(ctx, user);
}

async function setRent(ctx, user) {
  return adminCmd.setRent(ctx, user);
}

async function pay(ctx, user) {
  return adminCmd.pay(ctx, user);
}

async function setInitialReadings(ctx, user) {
  return adminCmd.setInitialReadings(ctx, user);
}

// ---- Landlord management ----

async function addAdmin(ctx, user) {
  session.setSession(user.user_id, { flow: 'add_admin', step: 'user_id' });
  await ctx.reply('Введите Telegram ID нового арендодателя:', keyboards.removeKeyboard());
}

async function inviteAdmin(ctx, user) {
  const token = await queries.createInviteToken('admin');
  const link = `https://t.me/${config.BOT_USERNAME}?start=${token.token}`;
  await ctx.reply(
    `🔗 Ссылка-приглашение для арендодателя:\n${link}\n\nСрок действия: 7 дней.\nПосле регистрации используйте /manage_subscription для настройки подписки.`
  );
}

async function listAdmins(ctx, user) {
  const subs = await queries.listAllSubscriptions();
  if (!subs.length) return ctx.reply('Нет арендодателей.');
  let msg = `Арендодатели:\n\n`;
  for (const s of subs) {
    const flatCount = await queries.countFlatsForAdmin(s.admin_user_id);
    const active = queries.isSubscriptionActive(s);
    msg += `ID: ${s.admin_user_id} | ${active ? '✅' : '❌'} | до ${formatDate(s.end_date)} | квартир: ${flatCount}/${s.max_flats}\n`;
  }
  await ctx.reply(msg);
}

async function manageSubscription(ctx, user) {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 4) {
    return ctx.reply('Использование: /manage_subscription <user_id> <ГГГГ-ММ-ДД> <max_flats>');
  }
  const targetUserId = parseInt(parts[1]);
  const endDate = parts[2];
  const maxFlats = parseInt(parts[3]);
  if (!targetUserId || !isValidDateStr(endDate) || isNaN(maxFlats) || maxFlats < 1) {
    return ctx.reply('Некорректные данные. Формат: /manage_subscription <user_id> <ГГГГ-ММ-ДД> <max_flats>');
  }
  const targetUser = await queries.getUser(targetUserId);
  if (!targetUser) return ctx.reply('Пользователь не найден.');
  if (targetUser.role !== 'admin') return ctx.reply('Пользователь не является арендодателем.');

  const existing = await queries.getSubscription(targetUserId);
  if (existing) {
    await queries.updateSubscription(targetUserId, endDate, maxFlats);
  } else {
    await queries.createSubscription(targetUserId, endDate, maxFlats);
  }
  await ctx.reply(`✅ Подписка обновлена для ${targetUserId}:\nДо: ${formatDate(endDate)}\nЛимит квартир: ${maxFlats}`);
  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `🔔 Ваша подписка обновлена:\nДо: ${formatDate(endDate)}\nЛимит квартир: ${maxFlats}\n\nВсе функции снова доступны.`
    );
  } catch (e) { /* ignore */ }
}

async function superAdminStats(ctx, user) {
  const stats = await queries.getGlobalStats();
  let msg = `📊 Общая статистика\n\n`;
  msg += `Арендодателей: ${stats.adminCount}\n`;
  msg += `Квартир: ${stats.flatCount}\n`;
  msg += `Активных подписок: ${stats.activeSubs}\n`;
  msg += `Общая задолженность: ${formatMoney(stats.totalDebt)}`;
  await ctx.reply(msg);
}

async function summary(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  let msg = `📊 Сводка по вашим квартирам:\n\n`;
  if (flats.length === 0) {
    msg += `У вас нет квартир.\n\n`;
  } else {
    let totalDebt = 0;
    let totalOverpay = 0;
    for (const f of flats) {
      const balance = await queries.getBalance(f.id);
      if (balance > 0) totalDebt += balance;
      else totalOverpay += Math.abs(balance);
      const balStr = balance > 0 ? `долг ${formatMoneyShort(balance)}` : balance < 0 ? `переплата ${formatMoneyShort(Math.abs(balance))}` : `0`;
      const tenants = await queries.getTenantsForFlat(f.id);
      msg += `${f.id}. ${f.name} — ${balStr} (арендаторов: ${tenants.length})\n`;
    }
    msg += `\nОбщий долг: ${formatMoney(totalDebt)}\n`;
    msg += `Общая переплата: ${formatMoney(totalOverpay)}\n`;
  }
  const stats = await queries.getGlobalStats();
  msg += `\n📊 Общая статистика по системе:\n`;
  msg += `Арендодателей: ${stats.adminCount}\n`;
  msg += `Квартир: ${stats.flatCount}\n`;
  msg += `Активных подписок: ${stats.activeSubs}\n`;
  msg += `Общая задолженность: ${formatMoney(stats.totalDebt)}`;
  await ctx.reply(msg);
}

// ---- Session input handlers ----

async function handleAddAdminInput(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim();

  if (sess.step === 'user_id') {
    const targetId = parseInt(text);
    if (!targetId) {
      return ctx.reply('Некорректный Telegram ID. Введите число:');
    }
    const existing = await queries.getUser(targetId);
    if (existing) {
      session.clearSession(user.user_id);
      return ctx.reply('Пользователь уже зарегистрирован. Используйте /manage_subscription.', keyboards.adminMainMenu());
    }
    session.updateSession(user.user_id, { step: 'end_date', targetId });
    return ctx.reply('Введите дату окончания подписки (ГГГГ-ММ-ДД):');
  }

  if (sess.step === 'end_date') {
    if (!isValidDateStr(text)) {
      return ctx.reply('Некорректный формат даты. Используйте ГГГГ-ММ-ДД:');
    }
    session.updateSession(user.user_id, { step: 'max_flats', endDate: text });
    return ctx.reply('Введите максимальное количество квартир:');
  }

  if (sess.step === 'max_flats') {
    const maxFlats = parseInt(text);
    if (isNaN(maxFlats) || maxFlats < 1) {
      return ctx.reply('Введите целое число больше 0:');
    }
    await queries.createUser(sess.targetId, 'admin');
    await queries.createSubscription(sess.targetId, sess.endDate, maxFlats);
    session.clearSession(user.user_id);
    await ctx.reply(
      `✅ Арендодатель добавлен.\nID: ${sess.targetId}\nПодписка до: ${formatDate(sess.endDate)}\nЛимит квартир: ${maxFlats}`,
      keyboards.adminMainMenu()
    );
    try {
      await bot.telegram.sendMessage(
        sess.targetId,
        `🔔 Вы зарегистрированы как арендодатель.\nПодписка до: ${formatDate(sess.endDate)}\nЛимит квартир: ${maxFlats}\n\nИспользуйте /start для начала работы.`
      );
    } catch (e) { /* ignore */ }
  }
}

// Delegate shared session handlers to admin module
async function handlePaymentInput(ctx, user) {
  return adminCmd.handlePaymentInput(ctx, user);
}

async function handleTariffChange(ctx, user, tariffType) {
  return adminCmd.handleTariffChange(ctx, user, tariffType);
}

async function handleTariffInput(ctx, user) {
  return adminCmd.handleTariffInput(ctx, user);
}

async function handleTariffDate(ctx, user) {
  return adminCmd.handleTariffDate(ctx, user);
}

module.exports = {
  superAdminStart,
  superAdminHelp,
  addFlat,
  selectFlat,
  listFlats,
  deleteFlatCmd,
  history,
  stats,
  summary,
  inviteTenant,
  removeUser,
  listUsers,
  toggleRent,
  setRent,
  pay,
  setInitialReadings,
  addAdmin,
  inviteAdmin,
  listAdmins,
  manageSubscription,
  superAdminStats,
  handleAddAdminInput,
  handlePaymentInput,
  handleTariffChange,
  handleTariffInput,
  handleTariffDate,
};
