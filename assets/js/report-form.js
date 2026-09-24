import { REACTIONS } from './confidence.js';
import { cleanText, findListedGift, validateItemReport } from './item-rules.js';

// The player-facing wording for each tier, in the game's own terms. The values
// are the five tiers from confidence.js; a test keeps the two in step.
export const REACTION_PROMPTS = [
  { value: 'none', label: 'They didn’t like it — no support gained' },
  { value: 'slight', label: 'They kind of liked it — small gain' },
  { value: 'liked', label: 'They liked it — moderate gain' },
  { value: 'loved', label: 'They really liked it — big gain' },
  { value: 'favorite', label: 'They really liked it, with two yellow arrows — double points' },
];

// Option values that can never collide with a data id: ID_PATTERN has no "_".
export const MISSING_ITEM = '__missing-item__';
export const NOT_LISTED = '__not-listed__';

export const ITEM_SUCCESS = 'Thanks — it’ll appear on the site once it’s reviewed.';

const HUMAN_CHECK = 'Complete the “I’m human” check first.';

// Pure. Mirrors the Worker's own validation so a contributor is told what is
// wrong before a request is spent -- the Worker still re-checks everything,
// because a browser check is a courtesy, not a control.
export function buildReportPayload({ character, gift, reaction, turnstileToken } = {}) {
  const errors = [];
  if (!character) errors.push('Pick which character received the gift.');
  if (!gift) errors.push('Pick which gift you gave.');
  if (!REACTIONS.includes(reaction)) errors.push('Pick what the game showed you.');

  if (!turnstileToken) errors.push(HUMAN_CHECK);

  if (errors.length) return { errors, payload: null };
  return {
    errors,
    payload: {
      character, gift, reaction,
      turnstileToken,
    },
  };
}

// Pure. Same rule as every view: a spoiler character is left out while
// spoilers are hidden, and a non-giftable character never appears regardless.
// Defaults to hiding spoilers (fail closed).
export function reportCharacterOptions(characters, { hideSpoilers = true } = {}) {
  return characters.filter((c) => c.giftable && !(hideSpoilers && c.spoiler));
}

// Pure. The in-game line select: our categories by the words the game shows
// (the label when we have none), sorted, then the way out for a line we do
// not have yet.
export function categoryLineOptions(categories) {
  const listed = (Array.isArray(categories) ? categories : [])
    .map((category) => ({ value: category.id, label: category.inGameDescriptor || category.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  return [...listed, { value: NOT_LISTED, label: 'Not listed — type it' }];
}

// Pure. The missing-item twin of buildReportPayload. The rules are
// item-rules.js's, so the form refuses exactly what the Worker would. An item
// that is already listed is the first thing the player hears about; `listed`
// comes back so the caller can link to it.
export function buildItemReportPayload({
  name, category, categoryLine, rarity, character, reaction, turnstileToken,
} = {}, { gifts = [] } = {}) {
  const body = {
    name: cleanText(name) ?? '',
    category: category && category !== NOT_LISTED ? category : null,
    categoryLine: category === NOT_LISTED ? (cleanText(categoryLine) ?? '') : null,
    rarity: rarity || null,
    character: character || null,
    reaction: reaction || null,
  };

  const listed = findListedGift(gifts, body.name);
  const errors = listed ? [`That’s already listed as ${listed.name}.`] : [];
  errors.push(...validateItemReport(body).errors);
  if (!turnstileToken) errors.push(HUMAN_CHECK);

  if (errors.length) return { errors, payload: null, listed };
  return { errors, payload: { ...body, turnstileToken }, listed };
}

function option(value, text) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}

function fillOptions(select, options, placeholder) {
  select.replaceChildren();
  select.append(option('', placeholder));
  for (const { value, label } of options) select.append(option(value, label));
}

function fillSelect(select, items, placeholder) {
  fillOptions(select, items.map((item) => ({ value: item.id, label: item.name })), placeholder);
}

// Returns the "not given" choice, which only missing-item mode shows: there
// the result is optional, and a radio cannot be unticked, so without it a
// player who picked a reaction by mistake could never get back to "neither".
// It is a <div> so that `hidden` works -- .reaction-choice sets a display.
function fillReactions(fieldset) {
  for (const prompt of REACTION_PROMPTS) {
    const label = document.createElement('label');
    label.className = 'reaction-choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'reaction';
    input.value = prompt.value;
    label.append(input, document.createTextNode(` ${prompt.label}`));
    fieldset.append(label);
  }

  const notGiven = document.createElement('div');
  notGiven.hidden = true;
  const label = document.createElement('label');
  label.className = 'reaction-choice';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'reaction';
  input.value = '';
  label.append(input, document.createTextNode(' I haven’t given it to anyone yet'));
  notGiven.append(label);
  fieldset.append(notGiven);
  return notGiven;
}

// Wires the dialog. `elements` is every node the form needs, passed in rather
// than looked up, so this module keeps no top-level DOM access.
//
// One dialog, two modes. The gift select's last option switches it into
// missing-item mode; `openMissingItem` opens it there directly.
export function createReportForm({
  elements, index, api, turnstile, onSubmitted = () => {},
  getFilters = () => ({ hideSpoilers: true }),
}) {
  const {
    dialog, form, character, characterField, gift, reactions, reactionsLegend, status, cancel, submit,
    itemFields, itemName, itemDuplicate, itemCategory, itemLineField, itemLine, itemRarity, itemCharacter,
  } = elements;

  const characterOptions = () => reportCharacterOptions(index.characters, { hideSpoilers: getFilters().hideSpoilers });

  fillSelect(character, characterOptions(), 'Choose a character…');
  fillSelect(gift, index.gifts, 'Choose a gift…');
  // Last, so every listed gift is in front of it.
  gift.append(option(MISSING_ITEM, 'My item isn’t listed…'));
  fillOptions(itemCategory, categoryLineOptions(index.categories), 'Choose the line the game shows…');
  const notGiven = fillReactions(reactions);

  const missingMode = () => gift.value === MISSING_ITEM;
  const checkedValue = (group, name) => group.querySelector(`input[name="${name}"]:checked`)?.value ?? '';

  function setStatus(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  // Only wrappers are hidden, never a label: `dialog label` sets a display,
  // which beats the hidden attribute.
  //
  // `mode` remembers the dialog's item/result state across calls so a genuine
  // flip can be told apart from a same-mode refresh. A success message left
  // over from an item report (ITEM_SUCCESS, tone "success") would otherwise
  // linger once the player switches the gift select to a listed gift and the
  // dialog moves into result mode; an error is left alone; `mode` starts
  // `null` so the very first call -- before there is a "previous" mode --
  // never clears anything.
  let mode = null;
  function syncMode() {
    const missing = missingMode();
    if (mode !== null && missing !== mode && status.dataset.tone === 'success') setStatus('');
    mode = missing;
    itemFields.hidden = !missing;
    characterField.hidden = missing;
    notGiven.hidden = !missing;
    itemLineField.hidden = !(missing && itemCategory.value === NOT_LISTED);
    reactionsLegend.textContent = missing ? 'They… (optional)' : 'What did the game show?';
  }

  // Live, so a player learns the item is already listed before filling in the
  // rest, and gets a link to it.
  function syncDuplicate() {
    const listed = missingMode() ? findListedGift(index.gifts, itemName.value) : null;
    itemDuplicate.hidden = !listed;
    if (!listed) {
      itemDuplicate.replaceChildren();
      return;
    }
    const link = document.createElement('a');
    link.href = `#/gift/${listed.id}`;
    link.textContent = listed.name;
    link.addEventListener('click', () => dialog.close());
    itemDuplicate.replaceChildren(document.createTextNode('That’s already listed as '), link, document.createTextNode('.'));
  }

  gift.addEventListener('change', () => {
    syncMode();
    syncDuplicate();
  });
  itemCategory.addEventListener('change', syncMode);
  itemName.addEventListener('input', syncDuplicate);
  cancel.addEventListener('click', () => dialog.close());

  async function send(payload, submitCall) {
    submit.disabled = true;
    setStatus('Sending…');
    const result = await submitCall(payload);
    submit.disabled = false;

    // A spent token cannot be reused whether the request succeeded or failed,
    // so the widget is reset either way.
    turnstile.reset();

    if (!result.ok) setStatus(result.error);
    return result.ok;
  }

  async function submitResult() {
    const { errors, payload } = buildReportPayload({
      character: character.value,
      gift: gift.value,
      reaction: checkedValue(reactions, 'reaction'),
      turnstileToken: turnstile.token(),
    });
    if (errors.length) {
      setStatus(errors[0]);
      return;
    }
    if (!(await send(payload, (p) => api.submitReport(p)))) return;

    setStatus('');
    dialog.close();
    form.reset();
    onSubmitted();
  }

  async function submitItem() {
    const { errors, payload } = buildItemReportPayload({
      name: itemName.value,
      category: itemCategory.value,
      categoryLine: itemLine.value,
      rarity: checkedValue(itemRarity, 'rarity'),
      character: itemCharacter.value,
      reaction: checkedValue(reactions, 'reaction'),
      turnstileToken: turnstile.token(),
    }, { gifts: index.gifts });
    if (errors.length) {
      setStatus(errors[0]);
      return;
    }
    if (!(await send(payload, (p) => api.submitItemReport(p)))) return;

    // Nothing public changes -- an item report is hidden until approved -- so
    // the dialog stays open to say it arrived, and onSubmitted (the overlay
    // refresh) is not called. It is cleared but stays in missing-item mode
    // for a player with several finds.
    form.reset();
    gift.value = MISSING_ITEM;
    syncMode();
    syncDuplicate();
    setStatus(ITEM_SUCCESS, 'success');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    return missingMode() ? submitItem() : submitResult();
  });

  // Rebuilt on every open rather than once at creation, since the filter
  // toggle is a runtime control (app.js) and both character selects must
  // reflect its current value, not the value at page load. Reset first, then
  // pre-fill: this covers Cancel, Escape and any other close path at once --
  // otherwise a cancelled report's answers survive into the next one.
  function prepare() {
    fillSelect(character, characterOptions(), 'Choose a character…');
    fillSelect(itemCharacter, characterOptions(), 'Not given to anyone yet');
    form.reset();
    setStatus('');
  }

  async function show() {
    syncMode();
    syncDuplicate();
    dialog.showModal();
    try {
      await turnstile.mount();
    } catch {
      setStatus('The “I’m human” check could not load. Try again in a moment.');
    }
  }

  return {
    async open(characterId = '', giftId = '') {
      prepare();
      character.value = characterId;
      gift.value = giftId;
      await show();
    },

    async openMissingItem(name = '') {
      prepare();
      gift.value = MISSING_ITEM;
      itemName.value = cleanText(name) ?? '';
      await show();
    },
  };
}
