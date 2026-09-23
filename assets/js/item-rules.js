import { REACTIONS } from './confidence.js';

// The rules for missing-item reports, in one place. The report form, the
// Worker (which imports this file by relative path -- wrangler bundles it),
// the review page and the nightly sync all use them, so a name the form
// accepts is a name every later step accepts too. Pure: no DOM, no network.

// Free text is new to this project. It is confined to short fields with a
// deliberately small character set: letters, digits, spaces and the
// punctuation real item names use (apostrophes straight and curly, hyphens,
// full stops, curly double quotes).
export const TEXT_PATTERN = /^[A-Za-z0-9 '\-’“”.]{2,40}$/;

// The same shape the data files use for every id.
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const RARITIES = ['common', 'uncommon', 'rare'];

const TEXT_RULE = '2–40 characters: letters, numbers, spaces, apostrophes, hyphens, full stops or curly quotes';
const NAME_ERROR = `The item name must be ${TEXT_RULE}.`;
const LINE_ERROR = `The in-game line must be ${TEXT_RULE}.`;
const NO_LINE_ERROR = 'Pick the in-game “Primarily enjoyed by …” line, or type it if it isn’t listed.';
const BOTH_LINES_ERROR = 'Send either a listed in-game line or a typed one, not both.';
const RARITY_ERROR = 'Rarity must be common, uncommon or rare, or left as not sure.';
const PAIR_ERROR = 'Pick both who you gave it to and how they reacted, or neither.';
const DECISION_ERROR = 'decision must be "approve" or "reject"';

// null and undefined both mean "not sent". Anything else was sent and must be
// valid -- an empty string included.
const present = (value) => value !== null && value !== undefined;
const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

export function cleanText(value) {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/\s+/g, ' ');
}

export function isValidText(value) {
  return TEXT_PATTERN.test(cleanText(value) ?? '');
}

// For duplicate detection and grouping only, never for display: every
// spelling of one item -- "Horse-Grooming Kit", "horse grooming kit" --
// becomes the same key.
export function normalizeName(s) {
  return String(s ?? '').toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9]/g, '');
}

// New gift and category ids. Matches every slug already in gifts.json, which
// a real-data test pins.
export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/['’“”"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The review page's pre-fill: the project capitalises every word. It is only
// a suggestion, because exact in-game names are the exception the maintainer
// keeps ("History of a Master").
export function suggestName(s) {
  return (cleanText(s) ?? '').replace(
    /(^|[ -])([“"']?)([a-z])/g,
    (match, separator, quote, letter) => `${separator}${quote}${letter.toUpperCase()}`,
  );
}

export function findListedGift(gifts, name) {
  const key = normalizeName(name);
  if (key === '') return null;
  return (Array.isArray(gifts) ? gifts : []).find((gift) => normalizeName(gift.name) === key) ?? null;
}

// A name must also contain at least one letter or digit: "''" passes the
// character set but would group with nothing and slugify to an empty id.
function checkName(value, errors) {
  const name = cleanText(value);
  if (!isValidText(name) || normalizeName(name) === '') errors.push(NAME_ERROR);
  return name;
}

function checkRarity(body, errors) {
  const rarity = present(body?.rarity) ? body.rarity : null;
  if (rarity !== null && !RARITIES.includes(rarity)) errors.push(RARITY_ERROR);
  return rarity;
}

// What the Worker accepts from a player. Exactly one of `category` (a listed
// id) and `categoryLine` (the typed in-game line). The result is optional, but
// it takes both halves or neither.
export function validateItemReport(body) {
  const errors = [];
  const name = checkName(body?.name, errors);

  let category = null;
  let categoryLine = null;
  const hasCategory = present(body?.category);
  const hasLine = present(body?.categoryLine);
  if (hasCategory && hasLine) errors.push(BOTH_LINES_ERROR);
  else if (!hasCategory && !hasLine) errors.push(NO_LINE_ERROR);
  else if (hasCategory) {
    if (isId(body.category)) category = body.category;
    else errors.push('category must be a gift-guide id');
  } else {
    categoryLine = cleanText(body.categoryLine);
    if (!isValidText(categoryLine)) errors.push(LINE_ERROR);
  }

  const rarity = checkRarity(body, errors);

  const hasCharacter = present(body?.character);
  const hasReaction = present(body?.reaction);
  if (hasCharacter !== hasReaction) errors.push(PAIR_ERROR);
  else if (hasCharacter) {
    if (!isId(body.character)) errors.push('character must be a gift-guide id');
    if (!REACTIONS.includes(body.reaction)) errors.push(`reaction must be one of: ${REACTIONS.join(', ')}`);
  }

  if (errors.length) return { errors, value: null };
  return {
    errors,
    value: {
      name, category, categoryLine, rarity,
      character: hasCharacter ? body.character : null,
      reaction: hasReaction ? body.reaction : null,
    },
  };
}

// What the review page sends for one report. An approval names at most one of
// an existing gift, a listed category or a new category -- and may name none,
// when nobody knows the category yet.
export function validateItemApproval(body) {
  if (body?.decision === 'reject') return { errors: [], value: { decision: 'reject' } };
  if (body?.decision !== 'approve') return { errors: [DECISION_ERROR], value: null };

  const errors = [];
  const name = checkName(body.name, errors);

  const targets = ['giftId', 'category', 'newCategory'].filter((key) => present(body[key]));
  if (targets.length > 1) errors.push('send at most one of giftId, category and newCategory');

  const giftId = present(body.giftId) ? body.giftId : null;
  if (giftId !== null && !isId(giftId)) errors.push('giftId must be a gift-guide id');

  const category = present(body.category) ? body.category : null;
  if (category !== null && !isId(category)) errors.push('category must be a gift-guide id');

  let newCategory = null;
  if (present(body.newCategory)) {
    const proposed = body.newCategory;
    if (typeof proposed !== 'object' || Array.isArray(proposed)) {
      errors.push('newCategory must be an object with id, label and inGameDescriptor');
    } else {
      newCategory = {
        id: proposed.id,
        label: cleanText(proposed.label),
        inGameDescriptor: cleanText(proposed.inGameDescriptor),
      };
      if (!isId(newCategory.id)) errors.push('newCategory.id must be a gift-guide id');
      if (!isValidText(newCategory.label)) errors.push(`newCategory.label must be ${TEXT_RULE}`);
      if (!isValidText(newCategory.inGameDescriptor)) errors.push(`newCategory.inGameDescriptor must be ${TEXT_RULE}`);
    }
  }

  const rarity = checkRarity(body, errors);

  if (typeof body.includeResult !== 'boolean') errors.push('includeResult must be true or false');

  if (errors.length) return { errors, value: null };
  return {
    errors,
    value: { decision: 'approve', name, giftId, category, newCategory, rarity, includeResult: body.includeResult },
  };
}
