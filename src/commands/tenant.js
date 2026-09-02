// Tenant command handlers
const queries = require('../queries');
const { formatMoney, formatMoneyShort, monthKey, isValidPositiveNumber, normalizeNumber, formatDate } = require('../utils');
const { calculateAccrual, buildAccrualDescription } = require('../billing');
const keyboards = require('../keyboards');
const session = require('../session');

async function tenantStart(ctx, user) {
  const flat = await queries.getFlat(user.flat_id);
  let msg = `Здравствуйте! Вы вошли как арендатор.\n`;
  if (flat) msg += `Квартира: ${flat.name}\n\n`;
  msg += `Доступные команды:\n`;
  msg += `/submit — передать показания счётчиков\n`;
  msg += `/balance — показать баланс и историю\n`;
  msg += `/help — инструкция`;
  await ctx.reply(msg);
}

async function tenantHelp(ctx) {
  const msg = `📋 Инструкция для арендатора

📊 Показания:
• /submit — передать показания счётчиков
• Показания запрашиваются только для услуг с тарифом > 0
• Порядок: электричество → вода → газ
• Показания не могут быть меньше предыдущих
• Можно повторно передать показания до конца месяца

💰 Баланс:
• /balance — показать текущий баланс и историю операций
• Положительный баланс = задолженность
• Отрицательный баланс = переплата (предоплата)

❓ По всем вопросам обращайтесь к арендодателю.`;
  await ctx.reply(msg);
}

async function tenantBalance(ctx, user) {
  const flat = await queries.getFlat(user.flat_id);
  if (!flat) return ctx.reply('Квартира не найдена.');
  const balance = await queries.getBalance(user.flat_id);
  const txns = await queries.getTransactions(user.flat_id, 20);

  let msg = `Квартира: ${flat.name}\n`;
  msg += `Текущий баланс: ${formatMoney(balance)}\n`;
  msg += balance > 0 ? ` (задолженность)\n` : balance < 0 ? ` (переплата)\n` : ` (нет долга)\n\n`;

  if (txns.length) {
    msg += `Последние операции:\n`;
    for (const t of txns.slice(0, 10)) {
      const date = new Date(t.created_at).toLocaleDateString('ru-RU');
      const sign = t.type === 'accrual' ? '+' : '-';
      msg += `${date} | ${t.type === 'accrual' ? 'Начисление' : 'Платёж'} | ${sign}${formatMoneyShort(Math.abs(t.amount))} | ${t.month}\n`;
    }
  }
  await ctx.reply(msg);
}

// Start meter reading submission flow
async function submitReadings(ctx, user, bot) {
  const flat = await queries.getFlat(user.flat_id);
  if (!flat) return ctx.reply('Квартира не найдена.');

  const tariff = await queries.getCurrentTariff(user.flat_id);
  if (!tariff) return ctx.reply('Тарифы не настроены. Обратитесь к арендодателю.');

  const mk = monthKey();
  const existing = await queries.getReadings(user.flat_id, mk);
  if (existing) {
    // Check if month is still current
    const now = new Date();
    const [m, y] = mk.split('.').map(Number);
    if (now.getMonth() !== m - 1 || now.getFullYear() !== y) {
      return ctx.reply('Срок сдачи показаний за этот месяц истёк. Обратитесь к арендодателю.');
    }
  }

  // Determine which meters to ask for (tariff > 0)
  const meters = [];
  if ((Number(tariff.electricity_tariff1) || 0) > 0 || (Number(tariff.electricity_tariff2) || 0) > 0 || (Number(tariff.electricity_tariff3) || 0) > 0) {
    meters.push('electricity');
  }
  if ((Number(tariff.water) || 0) > 0) meters.push('water');
  if ((Number(tariff.gas) || 0) > 0) meters.push('gas');

  if (meters.length === 0) {
    return ctx.reply('Все тарифы равны 0. Показания не требуются.');
  }

  // Get previous readings
  const prevReadings = await getPreviousReadings(user.flat_id, mk);

  session.setSession(user.user_id, {
    flow: 'meter_readings',
    flatId: user.flat_id,
    meters,
    currentIndex: 0,
    readings: {},
    prevReadings,
    mk,
  });

  await askForReading(ctx, user, bot);
}

async function getPreviousReadings(flatId, currentMonthKey) {
  // Try to get readings from previous month
  const [m, y] = currentMonthKey.split('.').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMk = `${String(prevDate.getMonth() + 1).padStart(2, '0')}.${prevDate.getFullYear()}`;
  const prevReading = await queries.getReadings(flatId, prevMk);
  if (prevReading) {
    return {
      electricity: Number(prevReading.electricity) || 0,
      water: Number(prevReading.water) || 0,
      gas: Number(prevReading.gas) || 0,
    };
  }
  // Fall back to latest readings
  const latest = await queries.getLatestReadings(flatId);
  if (latest) {
    return {
      electricity: Number(latest.electricity) || 0,
      water: Number(latest.water) || 0,
      gas: Number(latest.gas) || 0,
    };
  }
  return { electricity: 0, water: 0, gas: 0 };
}

async function askForReading(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  if (sess.currentIndex >= sess.meters.length) {
    await finalizeReadings(ctx, user, bot);
    return;
  }

  const meter = sess.meters[sess.currentIndex];
  const meterNames = {
    electricity: 'Электричество',
    water: 'Вода',
    gas: 'Газ',
  };
  const units = {
    electricity: 'кВт·ч',
    water: 'м³',
    gas: 'м³',
  };

  const prev = sess.prevReadings[meter] || 0;
  let msg = `📊 Передача показаний (${sess.currentIndex + 1}/${sess.meters.length})\n\n`;
  msg += `${meterNames[meter]} (тариф > 0)\n`;
  msg += `Предыдущее показание: ${prev} ${units[meter]}\n\n`;
  msg += `Введите текущее показание:`;
  await ctx.reply(msg, keyboards.removeKeyboard());
}

// Handle meter reading text input
async function handleReadingInput(ctx, user) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim().replace(',', '.');

  if (!isValidPositiveNumber(text)) {
    return ctx.reply('Введите положительное число (разделитель — точка). Попробуйте снова:');
  }

  const value = normalizeNumber(text);
  const meter = sess.meters[sess.currentIndex];
  const prev = sess.prevReadings[meter] || 0;

  if (value < prev) {
    return ctx.reply(
      `❌ Показание (${value}) меньше предыдущего (${prev}). Введите корректное значение:`
    );
  }

  const consumption = value - prev;
  const tariff = await queries.getCurrentTariff(sess.flatId);
  let amount = 0;
  if (meter === 'electricity') {
    const { calculateElectricity } = require('../billing');
    amount = calculateElectricity(consumption, tariff);
  } else {
    const rate = Number(tariff[meter]) || 0;
    amount = Math.round(consumption * rate * 100) / 100;
  }

  const meterNames = { electricity: 'Электричество', water: 'Вода', gas: 'Газ' };
  const units = { electricity: 'кВт·ч', water: 'м³', gas: 'м³' };

  session.updateSession(user.user_id, {
    pendingReading: { meter, value, prev, consumption, amount },
  });

  let msg = `Вы ввели показания: ${value}\n`;
  msg += `Прошлые показания: ${prev}\n`;
  msg += `Расход: ${consumption} ${units[meter]}\n`;
  msg += `Сумма: ${formatMoney(amount)}`;
  await ctx.reply(msg, keyboards.confirmKeyboard());
}

// Confirm reading callback
async function confirmReading(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  if (!sess || !sess.pendingReading) return;

  const { meter, value } = sess.pendingReading;
  sess.readings[meter] = value;
  sess.currentIndex++;
  session.updateSession(user.user_id, {
    readings: sess.readings,
    currentIndex: sess.currentIndex,
    pendingReading: null,
  });
  await ctx.answerCbQuery('✅ Показание сохранено');
  await askForReading(ctx, user, bot);
}

// Retry reading callback
async function retryReading(ctx, user, bot) {
  session.updateSession(user.user_id, { pendingReading: null });
  await ctx.answerCbQuery('Введите заново');
  await askForReading(ctx, user, bot);
}

// Finalize: save readings and create accrual
async function finalizeReadings(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  const flat = await queries.getFlat(sess.flatId);
  const tariff = await queries.getTariffForMonth(sess.flatId, sess.mk);
  if (!tariff) {
    session.clearSession(user.user_id);
    return ctx.reply('Тариф не найден для текущего месяца. Обратитесь к арендодателю.', keyboards.removeKeyboard());
  }

  const readings = {
    electricity: sess.readings.electricity ?? null,
    water: sess.readings.water ?? null,
    gas: sess.readings.gas ?? null,
  };
  const prevReadings = sess.prevReadings;

  // Save readings
  await queries.upsertReadings(sess.flatId, sess.mk, readings, prevReadings);

  // Delete old accrual if exists (recalculation)
  await queries.deleteAccrual(sess.flatId, sess.mk);

  // Calculate accrual
  const { breakdown, total } = calculateAccrual(readings, prevReadings, tariff, flat);
  const description = buildAccrualDescription(breakdown);
  const tariffsSnapshot = {
    water: tariff.water,
    electricity_threshold1: tariff.electricity_threshold1,
    electricity_tariff1: tariff.electricity_tariff1,
    electricity_threshold2: tariff.electricity_threshold2,
    electricity_tariff2: tariff.electricity_tariff2,
    electricity_tariff3: tariff.electricity_tariff3,
    gas: tariff.gas,
    tko: tariff.tko,
    uk: tariff.uk,
    caprepair: tariff.caprepair,
    rent_enabled: flat.rent_enabled,
    rent_amount: flat.rent_amount,
  };

  await queries.createAccrual(sess.flatId, sess.mk, total, description, tariffsSnapshot, user.user_id);
  const balance = await queries.getBalance(sess.flatId);

  // Notify tenant
  let tenantMsg = `✅ Показания сохранены за ${sess.mk}\n\n`;
  tenantMsg += `Детализация начисления:\n${description}\n\n`;
  tenantMsg += `Итого начислено: ${formatMoney(total)}\n`;
  tenantMsg += `Текущий баланс: ${formatMoney(balance)}`;
  await ctx.reply(tenantMsg, keyboards.removeKeyboard());

  // Notify landlord
  if (bot && flat.admin_user_id) {
    try {
      let adminMsg = `📋 Новые показания от арендатора\n`;
      adminMsg += `Квартира: ${flat.name} (№${flat.id})\n`;
      adminMsg += `Месяц: ${sess.mk}\n\n`;
      adminMsg += `Детализация:\n${description}\n\n`;
      adminMsg += `Итого начислено: ${formatMoney(total)}\n`;
      adminMsg += `Текущий баланс: ${formatMoney(balance)}`;
      await bot.telegram.sendMessage(flat.admin_user_id, adminMsg, keyboards.payKeyboard());
    } catch (e) {
      // landlord may not have started bot yet
    }
  }

  session.clearSession(user.user_id);
}
async function tenantStats(ctx, user) {
  const flatId = user.flat_id;
  if (!flatId) return ctx.reply('Квартира не найдена. Обратитесь к арендодателю.');

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

module.exports = {
  tenantStart,
  tenantHelp,
  tenantBalance,
  tenantStats,
  submitReadings,
  handleReadingInput,
  confirmReading,
  retryReading,
  finalizeReadings,
};
