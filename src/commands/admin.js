// Admin (landlord) command handlers
const queries = require('../queries');
const { Markup } = require('telegraf');
const {
  formatMoney,
  formatMoneyShort,
  monthKey,
  isValidDateStr,
  isCurrentOrFutureMonth,
  isValidPositiveNumber,
  normalizeNumber,
  round2,
  formatDate,
} = require('../utils');
const { calculateAccrual, buildAccrualDescription } = require('../billing');
const keyboards = require('../keyboards');
const session = require('../session');
const config = require('../config');

// /start for admin
async function adminStart(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  let selectedFlat = null;
  if (user.selected_flat_id) {
    selectedFlat = await queries.getFlat(user.selected_flat_id);
  }
  if (!selectedFlat && flats.length > 0) {
    selectedFlat = flats[0];
    await queries.setSelectedFlat(user.user_id, selectedFlat.id);
  }

  let msg = `Здравствуйте! Вы вошли как арендодатель.\n\n`;
  if (flats.length === 0) {
    msg += `У вас пока нет квартир. Используйте /addflat <название> для создания.`;
  } else {
    msg += `Активная квартира: ${selectedFlat ? `${selectedFlat.id}. ${selectedFlat.name}` : 'не выбрана'}\n`;
    msg += `Всего квартир: ${flats.length}\n\n`;
    msg += `Доступные команды:\n`;
    msg += `/addflat <название> — создать квартиру\n`;
    msg += `/select_flat <номер> — выбрать квартиру\n`;
    msg += `/flats — список квартир\n`;
    msg += `/deleteflat <номер> — удалить квартиру\n`;
    msg += `/history — история транзакций\n`;
    msg += `/stats — тарифы и показания\n`;
    msg += `/invite_tenant — пригласить арендатора\n`;
    msg += `/listusers — список пользователей\n`;
    msg += `/removeuser <ID> — удалить пользователя\n`;
    msg += `/subscribe — информация о подписке\n`;
    msg += `/toggle_rent — включить/выключить аренду\n`;
    msg += `/set_rent <сумма> — установить аренду\n`;
    msg += `/pay — внести платёж\n`;
    msg += `/set_initial_readings <эл> <вода> <газ> — начальные показания\n`;
    msg += `/help — подробная инструкция`;
  }
  await ctx.reply(msg, keyboards.adminMainMenu());
}

// /help for admin
async function adminHelp(ctx) {
  const msg = `📋 Инструкция для арендодателя

🏠 Квартиры:
• /addflat <название> — создать новую квартиру
• /select_flat <номер> — выбрать активную квартиру
• /flats — список всех квартир с балансами
• /deleteflat <номер> — удалить квартиру (только при нулевом сальдо)

⚙️ Тарифы (через кнопки меню):
• Изменение тарифа требует дату начала действия (ГГГГ-ММ-ДД)
• Дата не может быть раньше первого числа текущего месяца
• Если тариф = 0, показания по этому счётчику не запрашиваются
• Электричество: 5 чисел (порог1 тариф1 порог2 тариф2 тариф3) или одно число

📊 Показания и расчёты:
• /set_initial_readings <эл> <вода> <газ> — начальные показания
• /stats — текущие тарифы и последние показания
• /history — история начислений и платежей

👥 Арендаторы:
• /invite_tenant — ссылка-приглашение (можно указать срок доступа)
• /listusers — список пользователей
• /removeuser <TelegramID> — удалить пользователя

💰 Платежи:
• /pay или кнопка «Внести платеж» — внести платёж
• /toggle_rent — включить/выключить учёт аренды
• /set_rent <сумма> — установить сумму аренды

📌 Подписка:
• /subscribe — информация о подписке
• /contact_superadmin — связаться с суперадминистратором

📅 Расписание:
• 23-24 числа — напоминания арендаторам о сдаче показаний
• 25-е — последний день сдачи показаний
• 26-е — уведомление арендодателю о несданных показаниях
• 8-го числа — напоминание об оплате`;
  await ctx.reply(msg);
}

// /addflat
async function addFlat(ctx, user) {
  const name = ctx.message.text.replace(/^\/addflat\s*/i, '').trim();
  if (!name) {
    return ctx.reply('Укажите название квартиры: /addflat <название>');
  }
  const sub = await queries.getSubscription(user.user_id);
  if (!sub || !queries.isSubscriptionActive(sub)) {
    return ctx.reply('Ваша подписка истекла. Используйте /contact_superadmin для связи.');
  }
  const count = await queries.countFlatsForAdmin(user.user_id);
  if (count >= sub.max_flats) {
    return ctx.reply(`Превышен лимит квартир (${sub.max_flats}). Обратитесь к суперадминистратору.`);
  }
  const flat = await queries.createFlat(name, user.user_id);
  await queries.createDefaultTariff(flat.id);
  await queries.setSelectedFlat(user.user_id, flat.id);
  await ctx.reply(`✅ Квартира «${name}» создана (№${flat.id}). Она выбрана как активная.`);
}

// /select_flat
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
  await ctx.reply(`Активная квартира: ${flat.id}. ${flat.name}\nТекущий баланс: ${formatMoney(balance)}`);
}

// /flats
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

// /deleteflat
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
    return ctx.reply(`❌ Нельзя удалить квартиру с ненулевым сальдо (${formatMoney(balance)}). Сначала урегулируйте задолженность.`);
  }
  await queries.deleteFlat(flatId);
  await ctx.reply(`✅ Квартира «${flat.name}» удалена вместе со всеми данными.`);
}

// /history
async function history(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру: /select_flat <номер>');
  const txns = await queries.getTransactions(flatId);
  if (!txns.length) return ctx.reply('История пуста.');
  let msg = `История транзакций:\n\n`;
  for (const t of txns.slice(0, 30)) {
    const date = new Date(t.created_at).toLocaleDateString('ru-RU');
    const sign = t.type === 'accrual' ? '+' : '-';
    msg += `${date} | ${t.type === 'accrual' ? 'Начисление' : 'Платёж'} | ${sign}${formatMoneyShort(Math.abs(t.amount))} | ${t.month}\n`;
    if (t.description) msg += `   ${t.description.split('\n').join(' ')}\n`;
  }
  const balance = await queries.getBalance(flatId);
  msg += `\nТекущий баланс: ${formatMoney(balance)}`;
  await ctx.reply(msg);
}

// /stats
async function stats(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру: /select_flat <номер>');
  const flat = await queries.getFlat(flatId);
  const tariff = await queries.getCurrentTariff(flatId);
  const readings = await queries.getLatestReadings(flatId);
  const balance = await queries.getBalance(flatId);

  let msg = `Квартира: ${flat.id}. ${flat.name}\n\n`;
  msg += `Текущие тарифы:\n`;
  msg += `  Вода: ${tariff?.water || 0} руб./м³\n`;
  msg += `  Электричество: т1=${tariff?.electricity_threshold1 || 150} т2=${tariff?.electricity_threshold2 || 800}\n`;
  msg += `    тариф1=${tariff?.electricity_tariff1 || 0} тариф2=${tariff?.electricity_tariff2 || 0} тариф3=${tariff?.electricity_tariff3 || 0}\n`;
  msg += `  Газ: ${tariff?.gas || 0} руб./м³\n`;
  msg += `  ТКО: ${tariff?.tko || 0} руб.\n`;
  msg += `  УК: ${tariff?.uk || 0} руб.\n`;
  msg += `  Капремонт: ${tariff?.caprepair || 0} руб.\n`;
  msg += `  Аренда: ${flat.rent_enabled ? formatMoneyShort(flat.rent_amount) : 'выключена'}\n\n`;
  if (readings) {
    msg += `Последние показания (${readings.month}):\n`;
    msg += `  Электричество: ${readings.electricity || '—'}\n`;
    msg += `  Вода: ${readings.water || '—'}\n`;
    msg += `  Газ: ${readings.gas || '—'}\n\n`;
  }
  msg += `Текущий баланс: ${formatMoney(balance)}`;
  await ctx.reply(msg);
}

// /invite_tenant
async function inviteTenant(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру: /select_flat <номер>');
  const parts = ctx.message.text.split(/\s+/);
  let accessUntil = null;
  if (parts[1] && isValidDateStr(parts[1])) {
    accessUntil = parts[1];
  }
  const token = await queries.createInviteToken('tenant', flatId, accessUntil);
  const link = `https://t.me/${config.BOT_USERNAME}?start=${token.token}`;
  let msg = `🔗 Ссылка-приглашение для арендатора:\n${link}\n\n`;
  msg += `Срок действия ссылки: 7 дней.\n`;
  msg += accessUntil ? `Доступ арендатора до: ${formatDate(accessUntil)}` : `Доступ бессрочный.`;
  await ctx.reply(msg);
}

// /removeuser
async function removeUser(ctx, user) {
  const targetId = parseInt(ctx.message.text.replace(/^\/removeuser\s*/i, '').trim());
  if (!targetId) return ctx.reply('Укажите Telegram ID: /removeuser <TelegramID>');
  const targetUser = await queries.getUser(targetId);
  if (!targetUser) return ctx.reply('Пользователь не найден.');
  if (targetUser.role === 'super_admin') return ctx.reply('Нельзя удалить суперадминистратора.');

  if (targetUser.role === 'tenant') {
    if (user.role === 'admin') {
      const flat = await queries.getFlat(targetUser.flat_id);
      if (!flat || flat.admin_user_id !== user.user_id) {
        return ctx.reply('Этот арендатор не принадлежит вашим квартирам.');
      }
    }
    await queries.deactivateUser(targetId);
    await ctx.reply(`✅ Пользователь ${targetId} деактивирован. Записи сохранены для истории.`);
  } else {
    await ctx.reply('Можно удалять только арендаторов.');
  }
}

// /listusers
async function listUsers(ctx, user) {
  if (user.role === 'super_admin') {
    const allUsers = await queries.listAllUsers();
    let msg = `Все пользователи (${allUsers.length}):\n\n`;
    for (const u of allUsers.slice(0, 50)) {
      msg += `${u.user_id} | ${u.role} | flat=${u.flat_id || '—'} | active=${u.is_active ? 'yes' : 'no'}\n`;
    }
    return ctx.reply(msg);
  }
  const users = await queries.listUsersForAdmin(user.user_id);
  if (!users.length) return ctx.reply('В ваших квартирах нет арендаторов.');
  let msg = `Арендаторы ваших квартир:\n\n`;
  for (const u of users) {
    const flat = await queries.getFlat(u.flat_id);
    msg += `${u.user_id} | кв.${u.flat_id} ${flat?.name || ''} | доступ: ${u.access_until ? formatDate(u.access_until) : 'бессрочно'} | ${u.is_active ? 'активен' : 'деактивирован'}\n`;
  }
  await ctx.reply(msg);
}

// /subscribe
async function subscribeInfo(ctx, user) {
  const sub = await queries.getSubscription(user.user_id);
  if (!sub) return ctx.reply('Подписка не найдена. Обратитесь к суперадминистратору.');
  const active = queries.isSubscriptionActive(sub);
  const count = await queries.countFlatsForAdmin(user.user_id);
  let msg = `Информация о подписке:\n\n`;
  msg += `Статус: ${active ? '✅ Активна' : '❌ Истекла'}\n`;
  msg += `Дата окончания: ${formatDate(sub.end_date)}\n`;
  msg += `Лимит квартир: ${sub.max_flats}\n`;
  msg += `Использовано квартир: ${count}\n`;
  if (!active) {
    msg += `\n⚠️ Подписка истекла. Данные хранятся 3 месяца, затем будут удалены.\n`;
    msg += `Используйте /contact_superadmin для связи.`;
  }
  await ctx.reply(msg);
}

// /toggle_rent
async function toggleRent(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const flat = await queries.getFlat(flatId);
  const newState = !flat.rent_enabled;
  await queries.setRent(flatId, newState, flat.rent_amount);
  await ctx.reply(`Учёт аренды ${newState ? 'включён' : 'выключен'} для квартиры «${flat.name}».${newState ? ' Установите сумму: /set_rent <сумма>' : ''}`);
}

// /set_rent
async function setRent(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const amount = parseFloat(ctx.message.text.replace(/^\/set_rent\s*/i, '').trim().replace(',', '.'));
  if (isNaN(amount) || amount < 0) return ctx.reply('Укажите корректную сумму: /set_rent <сумма>');
  await queries.setRent(flatId, true, round2(amount));
  await ctx.reply(`Сумма аренды установлена: ${formatMoneyShort(amount)} руб./мес.`);
}

// /pay
async function pay(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const balance = await queries.getBalance(flatId);
  const flat = await queries.getFlat(flatId);
  session.setSession(user.user_id, {
    flow: 'payment',
    flatId,
    flatName: flat.name,
  });
  let msg = `Квартира: ${flat.name}\nТекущий баланс: ${formatMoney(balance)}\n\n`;
  msg += balance > 0 ? `Задолженность арендатора.\n` : balance < 0 ? `Переплата (предоплата).\n` : `Баланс нулевой.\n`;
  msg += `Введите сумму полученного платежа (число):`;
  await ctx.reply(msg, keyboards.removeKeyboard());
}

// /set_initial_readings
async function setInitialReadings(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 3) {
    return ctx.reply('Использование: /set_initial_readings <электричество> <вода> <газ>');
  }
  const [elec, water, gas] = parts.map(normalizeNumber);
  if ([elec, water, gas].some(n => isNaN(n) || n < 0)) {
    return ctx.reply('Все значения должны быть положительными числами.');
  }
  await queries.setInitialReadings(flatId, elec, water, gas);
  await ctx.reply(`✅ Начальные показания установлены:\nЭлектричество: ${elec}\nВода: ${water}\nГаз: ${gas}`);
}

// /contact_superadmin
async function contactSuperAdmin(ctx, user) {
  session.setSession(user.user_id, { flow: 'contact_superadmin' });
  await ctx.reply('Введите текст сообщения для суперадминистратора:', keyboards.removeKeyboard());
}

// Handle payment input
async function handlePaymentInput(ctx, user) {
  const sess = session.getSession(user.user_id);
  const amount = parseFloat(ctx.message.text.trim().replace(',', '.'));
  if (isNaN(amount) || amount <= 0) {
    session.clearSession(user.user_id);
    return ctx.reply('Некорректная сумма. Попробуйте снова: /pay', keyboards.adminMainMenu());
  }
  const mk = monthKey();
  await queries.createPayment(sess.flatId, mk, amount, user.user_id);
  const balance = await queries.getBalance(sess.flatId);
  session.clearSession(user.user_id);
  await ctx.reply(
    `✅ Платёж ${formatMoneyShort(amount)} внесён.\nНовый баланс: ${formatMoney(balance)}`,
    keyboards.adminMainMenu()
  );
}

// Handle contact_superadmin input
async function handleContactInput(ctx, user, bot) {
  const text = ctx.message.text;
  const state = await queries.getBotState();
  if (state?.super_admin_user_id) {
    await bot.telegram.sendMessage(
      state.super_admin_user_id,
      `📨 Сообщение от арендодателя ${user.user_id}:\n\n${text}`
    );
  }
  session.clearSession(user.user_id);
  await ctx.reply('✅ Сообщение отправлено суперадминистратору.', keyboards.adminMainMenu());
}

// Handle tariff change via menu buttons
async function handleTariffChange(ctx, user, tariffType) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const flat = await queries.getFlat(flatId);
  const tariff = await queries.getCurrentTariff(flatId);

  session.setSession(user.user_id, {
    flow: 'tariff_change',
    tariffType,
    flatId,
    flatName: flat.name,
  });

  let prompt = '';
  switch (tariffType) {
    case 'water':
      prompt = `Текущий тариф воды: ${tariff?.water || 0} руб./м³\nВведите новое значение:`;
      break;
    case 'gas':
      prompt = `Текущий тариф газа: ${tariff?.gas || 0} руб./м³\nВведите новое значение:`;
      break;
    case 'tko':
      prompt = `Текущий ТКО: ${tariff?.tko || 0} руб.\nВведите новое значение:`;
      break;
    case 'uk':
      prompt = `Текущий УК: ${tariff?.uk || 0} руб.\nВведите новое значение:`;
      break;
    case 'caprepair':
      prompt = `Текущий капремонт: ${tariff?.caprepair || 0} руб.\nВведите новое значение:`;
      break;
    case 'electricity':
      prompt = `Текущие пороги и тарифы:\n`;
      prompt += `  Порог1: ${tariff?.electricity_threshold1 || 150}, Тариф1: ${tariff?.electricity_tariff1 || 0}\n`;
      prompt += `  Порог2: ${tariff?.electricity_threshold2 || 800}, Тариф2: ${tariff?.electricity_tariff2 || 0}\n`;
      prompt += `  Тариф3: ${tariff?.electricity_tariff3 || 0}\n\n`;
      prompt += `Введите 5 чисел через пробел (порог1 тариф1 порог2 тариф2 тариф3)\n`;
      prompt += `или одно число для единого тарифа:`;
      break;
  }
  await ctx.reply(prompt, keyboards.removeKeyboard());
}

// Handle tariff input (second step: date)
async function handleTariffInput(ctx, user) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim();

  if (sess.tariffType === 'electricity') {
    const parts = text.split(/\s+/).map(n => n.replace(',', '.'));
    let tariffData;
    if (parts.length === 1) {
      const unified = parseFloat(parts[0]);
      if (isNaN(unified) || unified < 0) {
        session.clearSession(user.user_id);
        return ctx.reply('Некорректное значение. Попробуйте снова через меню.', keyboards.adminMainMenu());
      }
      tariffData = {
        electricity_threshold1: 999999,
        electricity_tariff1: unified,
        electricity_threshold2: 999999,
        electricity_tariff2: 0,
        electricity_tariff3: 0,
      };
    } else if (parts.length === 5) {
      const [th1, t1, th2, t2, t3] = parts.map(parseFloat);
      if ([th1, t1, th2, t2, t3].some(n => isNaN(n) || n < 0)) {
        session.clearSession(user.user_id);
        return ctx.reply('Некорректные значения. Попробуйте снова.', keyboards.adminMainMenu());
      }
      if (th1 >= th2) {
        return ctx.reply('❌ Порог1 должен быть меньше Порога2. Введите заново:');
      }
      tariffData = {
        electricity_threshold1: th1,
        electricity_tariff1: t1,
        electricity_threshold2: th2,
        electricity_tariff2: t2,
        electricity_tariff3: t3,
      };
    } else {
      session.clearSession(user.user_id);
      return ctx.reply('Введите 5 чисел или 1 число. Попробуйте снова через меню.', keyboards.adminMainMenu());
    }
    session.updateSession(user.user_id, { tariffData });
  } else {
    const value = parseFloat(text.replace(',', '.'));
    if (isNaN(value) || value < 0) {
      session.clearSession(user.user_id);
      return ctx.reply('Некорректное значение. Попробуйте снова через меню.', keyboards.adminMainMenu());
    }
    session.updateSession(user.user_id, { tariffData: { [sess.tariffType]: value } });
  }

  session.updateSession(user.user_id, { step: 'tariff_date' });
  await ctx.reply('Теперь укажите дату начала действия тарифа (ГГГГ-ММ-ДД):');
}

// Handle tariff date input
async function handleTariffDate(ctx, user) {
  const sess = session.getSession(user.user_id);
  const dateStr = ctx.message.text.trim();

  if (!isValidDateStr(dateStr)) {
    return ctx.reply('Некорректный формат даты. Используйте ГГГГ-ММ-ДД:');
  }
  if (!isCurrentOrFutureMonth(dateStr)) {
    return ctx.reply('❌ Дата не может быть раньше первого числа текущего месяца. Введите снова:');
  }

  const currentTariff = await queries.getCurrentTariff(sess.flatId);
  const merged = {
    water: currentTariff?.water || 0,
    electricity_threshold1: currentTariff?.electricity_threshold1 || 150,
    electricity_tariff1: currentTariff?.electricity_tariff1 || 0,
    electricity_threshold2: currentTariff?.electricity_threshold2 || 800,
    electricity_tariff2: currentTariff?.electricity_tariff2 || 0,
    electricity_tariff3: currentTariff?.electricity_tariff3 || 0,
    gas: currentTariff?.gas || 0,
    tko: currentTariff?.tko || 0,
    uk: currentTariff?.uk || 0,
    caprepair: currentTariff?.caprepair || 0,
    ...sess.tariffData,
  };

  await queries.createTariffRecord(sess.flatId, merged, dateStr);
  session.clearSession(user.user_id);
  await ctx.reply(`✅ Тариф обновлён с ${formatDate(dateStr)}.`, keyboards.adminMainMenu());
}

module.exports = {
  adminStart,
  adminHelp,
  addFlat,
  selectFlat,
  listFlats,
  deleteFlatCmd,
  history,
  stats,
  inviteTenant,
  removeUser,
  listUsers,
  subscribeInfo,
  toggleRent,
  setRent,
  pay,
  setInitialReadings,
  contactSuperAdmin,
  handlePaymentInput,
  handleContactInput,
  handleTariffChange,
  handleTariffInput,
  handleTariffDate,
};
