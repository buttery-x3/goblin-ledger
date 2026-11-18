export const LEGACY_SOURCE = 'https://news.blizzard.com/en-us/article/24307383/get-to-know-the-world-of-warcraft-forever-legacy-system';
export const RECIPE_SOURCE = 'https://www.foreverdb.app/en/forever/items/250990/recipe-mender-s-potion';
export const legacyRules = {
  version: 'forever-launch-1', perCharacterSpendCap: 16,
  classes: ['Druid', 'Hunter', 'Mage', 'Paladin', 'Priest', 'Rogue', 'Shaman', 'Warlock', 'Warrior'],
  trades: ['Alchemy', 'Blacksmithing', 'Enchanting', 'Engineering', 'Leatherworking', 'Tailoring'],
  classLevels: [25, 45, 60], professionSkills: [150, 225, 300]
};

const validAmount = n => Number.isSafeInteger(n) && n >= 0;
const matchName = (names, name) => names.find(n => n.toLowerCase() === String(name).toLowerCase());

export function challengeCatalog() {
  return [
    ...legacyRules.classes.flatMap(name => legacyRules.classLevels.map(target => ({id: 'class:' + name.toLowerCase() + ':' + target, name, target}))),
    ...legacyRules.trades.flatMap(name => legacyRules.professionSkills.map(target => ({id: 'profession:' + name.toLowerCase() + ':' + target, name, target})))
  ];
}

function nextChallenge(kind, name, value, thresholds, account) {
  if (!name || !validAmount(value)) return null;
  const target = thresholds.find(t => t >= value);
  if (!target) return null;
  const id = [kind, name.toLowerCase(), target].join(':');
  const earned = account[id];
  const status = earned === true ? 'already earned' : earned === false ? 'new point' : 'completion unknown';
  const remaining = target - value;
  return {id, target, remaining, status, source: LEGACY_SOURCE,
    label: name + ' ' + target + ' · ' + (remaining ? remaining + ' to go' : 'threshold reached') + ' · ' + status};
}

export function progressionForCharacter(character = {}, accountCompletion = {}) {
  const professions = Array.isArray(character.professions) ? character.professions : [];
  const name = matchName(legacyRules.classes, character.className);
  const classChallenge = nextChallenge('class', name, character.level, legacyRules.classLevels, accountCompletion);
  const professionChallenges = professions.map(p => nextChallenge('profession', matchName(legacyRules.trades, p?.name), p?.skill, legacyRules.professionSkills, accountCompletion)).filter(Boolean);
  const alchemy = professions.find(p => String(p?.name).toLowerCase() === 'alchemy');
  const known = character.knownRecipeIds?.includes(250990);
  const remaining = validAmount(alchemy?.skill) ? Math.max(130 - alchemy.skill, 0) : null;
  const status = known ? 'known' : remaining === null ? 'skill unknown' : remaining > 0 ? 'below threshold' : 'learning threshold met';
  const recipe = {id: 'menders-potion', outputId: 250946, teachingItemId: 250990, required: 130, remaining, status,
    label: "Mender’s Potion · " + (status === 'below threshold' ? remaining + ' Alchemy points to learn' : status),
    costFavor: 45, purchaseStanding: null, source: RECIPE_SOURCE};
  const rested = validAmount(character.restedXp) ? {amount: character.restedXp, wellRestedRank: character.wellRestedRank ?? null,
    projected: null, label: character.restedXp.toLocaleString('en-US') + ' rested XP observed'} : null;
  return {classChallenge, professionChallenges, recipe, rested, rulesVersion: legacyRules.version};
}
