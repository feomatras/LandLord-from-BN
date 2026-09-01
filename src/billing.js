// Billing engine: calculates utility charges based on tariffs and meter readings
const { round2 } = require('./utils');

function calculateElectricity(consumption, tariff) {
  const c = Number(consumption) || 0;
  const t1 = Number(tariff.electricity_tariff1) || 0;
  const t2 = Number(tariff.electricity_tariff2) || 0;
  const t3 = Number(tariff.electricity_tariff3) || 0;
  const th1 = Number(tariff.electricity_threshold1) || 150;
  const th2 = Number(tariff.electricity_threshold2) || 800;

  if (t1 === 0 && t2 === 0 && t3 === 0) return 0;

  let sum;
  if (c <= th1) {
    sum = c * t1;
  } else if (c <= th2) {
    sum = th1 * t1 + (c - th1) * t2;
  } else {
    sum = th1 * t1 + (th2 - th1) * t2 + (c - th2) * t3;
  }
  return round2(sum);
}

function calculateSimple(consumption, tariffRate) {
  return round2((Number(consumption) || 0) * (Number(tariffRate) || 0));
}

function calculateAccrual(readings, prevReadings, tariff, flat) {
  const breakdown = {};

  const elecConsumption = (Number(readings.electricity) || 0) - (Number(prevReadings.electricity) || 0);
  breakdown.electricity = {
    consumption: round2(Math.max(0, elecConsumption)),
    amount: calculateElectricity(Math.max(0, elecConsumption), tariff),
  };

  const waterConsumption = (Number(readings.water) || 0) - (Number(prevReadings.water) || 0);
  breakdown.water = {
    consumption: round2(Math.max(0, waterConsumption)),
    amount: calculateSimple(Math.max(0, waterConsumption), tariff.water),
  };

  const gasConsumption = (Number(readings.gas) || 0) - (Number(prevReadings.gas) || 0);
  breakdown.gas = {
    consumption: round2(Math.max(0, gasConsumption)),
    amount: calculateSimple(Math.max(0, gasConsumption), tariff.gas),
  };

  breakdown.tko = { amount: round2(Number(tariff.tko) || 0) };
  breakdown.uk = { amount: round2(Number(tariff.uk) || 0) };
  breakdown.caprepair = { amount: round2(Number(tariff.caprepair) || 0) };

  breakdown.rent = { amount: 0 };
  if (flat && flat.rent_enabled) {
    breakdown.rent = { amount: round2(Number(flat.rent_amount) || 0) };
  }

  const total = round2(
    breakdown.electricity.amount +
    breakdown.water.amount +
    breakdown.gas.amount +
    breakdown.tko.amount +
    breakdown.uk.amount +
    breakdown.caprepair.amount +
    breakdown.rent.amount
  );

  return { breakdown, total };
}

function buildAccrualDescription(breakdown) {
  const lines = [];
  if (breakdown.electricity.amount > 0)
    lines.push(`Электричество: ${breakdown.electricity.consumption} кВт·ч = ${breakdown.electricity.amount} руб.`);
  if (breakdown.water.amount > 0)
    lines.push(`Вода: ${breakdown.water.consumption} м³ = ${breakdown.water.amount} руб.`);
  if (breakdown.gas.amount > 0)
    lines.push(`Газ: ${breakdown.gas.consumption} м³ = ${breakdown.gas.amount} руб.`);
  if (breakdown.tko.amount > 0)
    lines.push(`ТКО: ${breakdown.tko.amount} руб.`);
  if (breakdown.uk.amount > 0)
    lines.push(`УК: ${breakdown.uk.amount} руб.`);
  if (breakdown.caprepair.amount > 0)
    lines.push(`Капремонт: ${breakdown.caprepair.amount} руб.`);
  if (breakdown.rent.amount > 0)
    lines.push(`Аренда: ${breakdown.rent.amount} руб.`);
  return lines.join('\n');
}

module.exports = {
  calculateElectricity,
  calculateSimple,
  calculateAccrual,
  buildAccrualDescription,
};
