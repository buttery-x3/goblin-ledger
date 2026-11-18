export const herbalismGuide = 'https://www.icy-veins.com/wow-forever/herbalism-leveling-guide';
export const gatheringGuide = 'https://afleurdenet.com/where-to-find-blindweed-and-ghost-mushroom-in-wow-forever-2026-farming-guide/';

const routeData = [
  ['skulk-rock', 'Skulk Rock', 'The Hinterlands', 'Gathering', 77, 42, 'Approach the cave by the river. Make a short detour from the herbalism circuit and return to the entrance.', herbalismGuide],
  ['jintha-alor', 'Jintha’Alor', 'The Hinterlands', 'Gathering', 79, 46, 'Reach the upper terrace and check its caves. Elite trolls guard the approach. Stealth can change the time and risk of this loop.', gatheringGuide],
  ['maraudon-purple', 'Maraudon · Purple entrance', 'Desolace', 'Instance', 25, 54, 'Follow the Purple entrance toward the Orange side. Track the full exit and reset in your elapsed time. Solo completion and the sustained reset limit need local evidence.', gatheringGuide],
];

export const routesCatalog = routeData.map(([id,name,zone,type,x,y,notes,source]) => ({
  id, name, zone, type, revision: 1, output: 'Ghost Mushroom', outputId: 8845,
  requirements: 'Herbalism 245', profession: 'Herbalism', skill: 245, notes, source,
  evidence: 'Guide-reported locality', exposure: null, coverage: 0,
  geometry: {
    id: id + '-locality', space: 'world-schematic', mapId: zone, continent: zone === 'Desolace' ? 'Kalimdor' : 'Eastern Kingdoms',
    floor: null, units: 'schematic percent, y increases south', transform: 'schematic-v1', build: 'Forever launch',
    precision: type === 'Instance' ? 'Approximate world entrance' : 'Approximate locality',
    x, y, source
  },
}));

export function checkedInt(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    const error = new Error(name + ' must be a whole number from ' + min + ' to ' + max);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export function copperValue(value) {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return BigInt(value);
}

export function proceeds(gross, feeBps) {
  if (gross == null || feeBps == null) return null;
  const fee = BigInt(checkedInt(feeBps, 'Sale cut', 0, 10000));
  return gross - (gross * fee / 10000n);
}

function finiteCopper(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function rateFor(total, numerator, denominator) {
  if (!denominator) return null;
  const scaled = total * BigInt(numerator), d = BigInt(denominator);
  const rounded = scaled >= 0n ? (scaled + d/2n)/d : -((-scaled + d/2n)/d);
  return finiteCopper(rounded);
}

export function farmReturns(runs, {sessionMinutes, approachMinutes, feeBps, prices, targetCopperPerHour = 100000, primaryItemId, loopCap = null}) {
  checkedInt(sessionMinutes, 'Session', 1, 1440);
  checkedInt(approachMinutes, 'Approach', 0, 1440);
  const primary = prices[primaryItemId];
  const available = Math.max(0, sessionMinutes - approachMinutes);
  const required = primary && primary.ask > 0 && feeBps != null && feeBps < 10000
    ? Math.ceil(targetCopperPerHour / (primary.ask * (1 - feeBps / 10000))) : null;
  const gaps = new Set();
  let minutes = 0, cash = 0n, vendor = 0n, auction = 0n, expenses = 0n, rare = 0n, units = 0;
  const rates = [];
  for (const run of runs) {
    minutes += run.elapsedMinutes;
    cash += BigInt(run.coinCopper);
    expenses += BigInt(run.expenseCopper);
    let runNet = BigInt(run.coinCopper - run.expenseCopper);
    let priced = true;
    for (const stack of run.haul) {
      const price = prices[stack.itemId] ?? {};
      if (stack.itemId === primaryItemId) units += stack.units;
      if (stack.exit === 'keep') continue;
      const unit = copperValue(stack.exit === 'vendor' ? price.sell : price.ask);
      const gross = unit == null ? null : BigInt(stack.units) * unit;
      const value = stack.exit === 'vendor' ? gross : proceeds(gross, feeBps);
      if (value == null) {
        gaps.add(stack.itemId + ' ' + (stack.exit === 'vendor' ? 'vendor value' : 'auction quote / fee'));
        priced = false;
        continue;
      }
      if (stack.exit === 'vendor') vendor += value;
      else auction += value;
      if (stack.rare) rare += value;
      runNet += value;
    }
    const rate = rateFor(runNet,60,run.elapsedMinutes);
    if (priced && rate != null) rates.push(rate);
  }
  const total = cash + vendor + auction - expenses;
  const loops = minutes ? Math.min(loopCap ?? Infinity, Math.floor(available * runs.length / minutes)) : null;
  const rate = rateFor(total,60,minutes);
  const sessionValue = loops == null ? null : rateFor(total,loops,runs.length);
  if (!minutes) gaps.add('Timed run or scenario yield');
  if (minutes && (rate == null || sessionValue == null)) gaps.add('Return exceeds display precision');
  return {
    runCount: runs.length, elapsedMinutes: minutes, loops, unitsPerHour: minutes ? 60 * units / minutes : null,
    rateCopperPerHour: gaps.size ? null : rate,
    sessionGoldCopper: gaps.size ? null : sessionValue,
    requiredUnitsPerHour: required, rangeCopperPerHour: rates.length ? [Math.min(...rates), Math.max(...rates)] : null,
    coinCopper: String(cash), vendorCopper: String(vendor), auctionCopper: String(auction),
    expenseCopper: String(expenses), rareCopper: String(rare), gaps: [...gaps],
  };
}

export function eligibility(route, character) {
  if (!character) return 'Unknown';
  const observed = character.professions?.find(p => p.name?.toLowerCase() === route.profession?.toLowerCase());
  if (!observed || !Number.isFinite(observed.skill)) return 'Unknown';
  return observed.skill >= route.skill ? 'Meets skill' : 'Below skill';
}

export function validRun(input) {
  if (!input || !Array.isArray(input.haul) || input.haul.length > 32) {
    throw Object.assign(new Error('Provide a haul of 0–32 stacks'), {statusCode:400});
  }
  let characterId=null;
  if (input.characterId!=null) {
    if (typeof input.characterId!=='string' || !input.characterId.trim() || input.characterId.length>160) {
      throw Object.assign(new Error('Invalid character identifier'),{statusCode:400});
    }
    characterId=input.characterId.trim();
  }
  return {
    character: String(input.character ?? '').trim().slice(0, 100), characterId,
    elapsedMinutes: checkedInt(input.elapsedMinutes, 'Elapsed minutes', 1, 1440),
    coinCopper: checkedInt(input.coinCopper ?? 0, 'Looted coin', 0, 1000000000),
    expenseCopper: checkedInt(input.expenseCopper ?? 0, 'Expenses', 0, 1000000000),
    haul: input.haul.map(stack => {
      if (!stack || !['auction','vendor','keep'].includes(stack.exit) || (stack.bound && stack.exit === 'auction')) {
        throw Object.assign(new Error('Choose a valid exit for each stack. Bound loot can be kept or vendored.'), {statusCode:400});
      }
      return {itemId: checkedInt(stack.itemId, 'Item ID', 1, 9999999), units: checkedInt(stack.units, 'Units', 1, 100000),
        exit: stack.exit, bound: stack.bound === true, rare: stack.rare === true};
    }),
  };
}
