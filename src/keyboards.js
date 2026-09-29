// Telegram keyboard builders
const { Markup } = require('telegraf');

// New button labels are mapped to the legacy labels in BUTTON_ALIASES,
// so users with an old cached keyboard keep working too.
function adminMainMenu() {
  return Markup.keyboard([
    ['💰 Платёж', '📥 Показания'],
    ['📜 История', '🏠 Квартиры'],
    ['⚙️ Тарифы', '🏷 Аренда'],
    ['🆘 Поддержка', '☰ Главное меню'],
  ]).resize();
}

function tariffsMenu() {
  return Markup.keyboard([
    ['Изменить тариф Воды', 'Изменить тариф Электричества'],
    ['Изменить тариф Газа', 'Изменить тариф ТКО'],
    ['Изменить тариф УК', 'Изменить Капремонт'],
    ['⬅️ Назад'],
  ]).resize();
}

function tenantMainMenu() {
  return Markup.keyboard([
    ['📥 Передать показания', '💳 Баланс'],
    ['📊 Статистика', '🆘 Поддержка'],
    ['☰ Главное меню'],
  ]).resize();
}

function cancelKeyboard() {
  return Markup.keyboard([['❌ Отмена']]).resize();
}

const BUTTON_ALIASES = {
  '💰 Платёж': 'Внести платеж',
  '📥 Показания': 'Ввести показания',
  '📜 История': 'История платежей',
  '🏠 Квартиры': 'Мои квартиры',
  '🏷 Аренда': 'Настройка аренды',
  '🆘 Поддержка': 'Поддержка',
  '☰ Главное меню': 'Главное меню',
  '⬅️ Назад': 'Главное меню',
  '📥 Передать показания': 'Передать показания',
  '💳 Баланс': 'Баланс',
  '📊 Статистика': 'Статистика',
  '❌ Отмена': 'отмена',
};

function trialStartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚀 Начать 14-дневный пробный период', 'start_trial')],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Подтвердить', 'confirm_reading'),
      Markup.button.callback('🔄 Ввести заново', 'retry_reading'),
    ],
  ]);
}

function payKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💳 Внести платеж', 'pay_action')],
  ]);
}

function deleteConfirmKeyboard(flatId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить', `confirm_delete_flat_${flatId}`),
      Markup.button.callback('❌ Отмена', 'cancel_delete_flat'),
    ],
  ]);
}

function deleteMeConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить', 'confirm_delete_me'),
      Markup.button.callback('❌ Отмена', 'cancel_delete_me'),
    ],
  ]);
}

function flatListKeyboard(flats) {
  const buttons = flats.map(f => [Markup.button.callback(`${f.id}. ${f.name}`, `select_flat_${f.id}`)]);
  return Markup.inlineKeyboard(buttons);
}

function removeKeyboard() {
  return Markup.removeKeyboard();
}

module.exports = {
  tariffsMenu,
  cancelKeyboard,
  BUTTON_ALIASES,
  adminMainMenu,
  tenantMainMenu,
  trialStartKeyboard,
  confirmKeyboard,
  payKeyboard,
  deleteConfirmKeyboard,
  deleteMeConfirmKeyboard,
  flatListKeyboard,
  removeKeyboard,
};
