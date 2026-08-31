'use strict';
const fs = require('fs');

const PATH = 'keno-auto.js';
let c = fs.readFileSync(PATH, 'utf8');

function must(oldText, newText, label) {
  if (!c.includes(oldText)) throw new Error('Не найден фрагмент: ' + label);
  c = c.replace(oldText, newText);
}

must(
`function makeSprintModel(draws, winnerCache, stateCache, drawCounts, dayIndices) {`,
`function groupForecastSnapshot(pred, ranked) {
  const label = state => state === 4 ? '4+' : String(state);
  const availableOrder = pred.order.filter(state => (pred.available[state] || []).length);
  const topState = availableOrder.length ? availableOrder[0] : null;
  const selectedStates = ranked.slice(0, 4).map(row => Number(row.state));
  const slotCounts = Array(5).fill(0);
  selectedStates.forEach(state => {
    if (state >= 0 && state <= 4) slotCounts[state] += 1;
  });

  const probabilities = {};
  const available = {};
  const slots = {};
  for (let state = 0; state <= 4; state += 1) {
    const key = label(state);
    probabilities[key] = Number((pred.probs[state] || 0).toFixed(6));
    available[key] = (pred.available[state] || []).map(Number);
    slots[key] = slotCounts[state];
  }

  return {
    topState,
    topGroup: topState === null ? null : label(topState),
    orderStates: availableOrder,
    orderGroups: availableOrder.map(label),
    probabilities,
    available,
    selectedStates,
    selectedGroups: [...new Set(selectedStates.map(label))],
    slots
  };
}

function makeSprintModel(draws, winnerCache, stateCache, drawCounts, dayIndices) {`,
'group helper'
);

must(
`    rows: ranked.slice(0, 4),
    signal: signal.signal,`,
`    rows: ranked.slice(0, 4),
    groupForecast: groupForecastSnapshot(pred, ranked),
    signal: signal.signal,`,
'sprint group field'
);

// marathon occurrence
const marStart = c.indexOf('function makeMarathonModel');
const oldRows = `    rows: ranked.slice(0, 4),
    signal: signal.signal,`;
const marIdx = c.indexOf(oldRows, marStart);
if (marIdx < 0) throw new Error('Не найден фрагмент: marathon group field');
c = c.slice(0, marIdx)
  + `    rows: ranked.slice(0, 4),
    groupForecast: groupForecastSnapshot(pred, ranked),
    signal: signal.signal,`
  + c.slice(marIdx + oldRows.length);

must(
`  const byDraw = new Map(draws.map(d => [d.draw, d]));

  // Старые прогнозы не переписываем.`,
`  const byDraw = new Map(draws.map(d => [d.draw, d]));
  const drawIndexByNumber = new Map(draws.map((d, i) => [Number(d.draw), i]));

  // Старые прогнозы не переписываем.`,
'draw index map'
);

must(
`    row.first = place === 0;
    row.checkedAt = new Date().toISOString();`,
`    row.first = place === 0;

    // Закрываем группу только если её прогноз был frozen заранее.
    // Уже закрытые старые строки задним числом не обогащаем.
    if (row.groupForecast && typeof row.groupForecast === 'object') {
      const actualIndex = drawIndexByNumber.get(Number(row.targetDraw));
      const prev = Number.isInteger(actualIndex) && actualIndex > 0
        ? draws[actualIndex - 1]
        : null;
      const actualCounts = prev ? counts(prev) : null;
      const actualGroupState = actualCounts
        ? Math.min(4, actualCounts[actualWinner] || 0)
        : null;
      const actualGroup = actualGroupState === 4
        ? '4+'
        : (actualGroupState === null ? null : String(actualGroupState));

      const selectedStates = Array.isArray(row.groupForecast.selectedStates)
        ? row.groupForecast.selectedStates.map(Number)
        : [];

      row.actualGroupState = actualGroupState;
      row.actualGroup = actualGroup;
      row.groupTopHit = actualGroupState !== null
        && Number(row.groupForecast.topState) === actualGroupState;
      row.groupCovered = actualGroupState !== null
        && selectedStates.includes(actualGroupState);
    }

    row.checkedAt = new Date().toISOString();`,
'close group result'
);

must(
`      columns: current[type].columns.slice(),
      checked: false`,
`      columns: current[type].columns.slice(),
      groupForecast: JSON.parse(JSON.stringify(current[type].groupForecast || null)),
      checked: false`,
'frozen group record'
);

must(
`    if (!existing) {
      forecasts.push(nextRecord);
    } else if (!existing.checked && existing.modelVersion !== MODEL_VERSION) {
      // Если для ещё не вышедшего тиража успел сохраниться прогноз старого
      // direct-v2, заменяем только эту незакрытую запись экранным 2.1.0.
      Object.assign(existing, nextRecord);
    }`,
`    if (!existing) {
      forecasts.push(nextRecord);
    } else if (!existing.checked && existing.modelVersion !== MODEL_VERSION) {
      // Если для ещё не вышедшего тиража успел сохраниться прогноз старого
      // direct-v2, заменяем только эту незакрытую запись экранным 2.1.0.
      Object.assign(existing, nextRecord);
    } else if (!existing.checked && !existing.groupForecast) {
      // Для текущего ещё не вышедшего frozen-прогноза столбцы не меняем.
      // Дописываем только снимок групп из того же состояния архива.
      existing.groupForecast = nextRecord.groupForecast;
    }`,
'pending group snapshot'
);

c = c.replace('    version: 3,', '    version: 4,');

fs.writeFileSync(PATH, c, 'utf8');
console.log('PASS: frozen group storage installed');
