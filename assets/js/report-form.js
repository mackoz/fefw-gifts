import { REACTIONS } from './confidence.js';

export const MAX_POINTS = 999;

// The player-facing wording for each tier, in the game's own terms. The values
// are the five tiers from confidence.js; a test keeps the two in step.
export const REACTION_PROMPTS = [
  { value: 'none', label: 'They didn’t like it — no support gained' },
  { value: 'slight', label: 'They kind of liked it — small gain' },
  { value: 'liked', label: 'They liked it — moderate gain' },
  { value: 'loved', label: 'They really liked it — big gain' },
  { value: 'favorite', label: 'They really liked it, with two yellow arrows — double points' },
];

const MAX_NOTE = 280;

// Pure. Mirrors the Worker's own validation so a contributor is told what is
// wrong before a request is spent -- the Worker still re-checks everything,
// because a browser check is a courtesy, not a control.
export function buildReportPayload({ character, gift, reaction, points, note, turnstileToken } = {}) {
  const errors = [];
  if (!character) errors.push('Pick which character received the gift.');
  if (!gift) errors.push('Pick which gift you gave.');
  if (!REACTIONS.includes(reaction)) errors.push('Pick what the game showed you.');

  let parsedPoints = null;
  if (points !== '' && points !== null && points !== undefined) {
    const value = Number(points);
    if (!Number.isInteger(value) || value < 0 || value > MAX_POINTS) {
      errors.push(`Support points must be a whole number from 0 to ${MAX_POINTS}, or left blank.`);
    } else {
      parsedPoints = value;
    }
  }

  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  if (trimmedNote.length > MAX_NOTE) errors.push(`Keep the note under ${MAX_NOTE} characters.`);

  if (!turnstileToken) errors.push('Complete the “I’m human” check first.');

  if (errors.length) return { errors, payload: null };
  return {
    errors,
    payload: {
      character, gift, reaction,
      points: parsedPoints,
      note: trimmedNote === '' ? null : trimmedNote,
      turnstileToken,
    },
  };
}

function fillSelect(select, items, placeholder) {
  select.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  select.append(blank);
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  }
}

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
}

// Wires the dialog. `elements` is every node the form needs, passed in rather
// than looked up, so this module keeps no top-level DOM access.
export function createReportForm({ elements, index, api, turnstile, onSubmitted = () => {} }) {
  const { dialog, form, character, gift, reactions, points, note, status, cancel, submit } = elements;

  fillSelect(character, index.characters.filter((c) => c.giftable), 'Choose a character…');
  fillSelect(gift, index.gifts, 'Choose a gift…');
  fillReactions(reactions);

  cancel.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = {
      character: character.value,
      gift: gift.value,
      reaction: reactions.querySelector('input[name="reaction"]:checked')?.value ?? '',
      points: points.value,
      note: note.value,
      turnstileToken: turnstile.token(),
    };

    const { errors, payload } = buildReportPayload(fields);
    if (errors.length) {
      status.textContent = errors[0];
      return;
    }

    submit.disabled = true;
    status.textContent = 'Sending…';
    const result = await api.submitReport(payload);
    submit.disabled = false;

    // A spent token cannot be reused whether the request succeeded or failed,
    // so the widget is reset either way.
    turnstile.reset();

    if (!result.ok) {
      status.textContent = result.error;
      return;
    }

    status.textContent = '';
    dialog.close();
    form.reset();
    onSubmitted();
  });

  return {
    async open(characterId = '', giftId = '') {
      status.textContent = '';
      character.value = characterId;
      gift.value = giftId;
      dialog.showModal();
      try {
        await turnstile.mount();
      } catch {
        status.textContent = 'The “I’m human” check could not load. Try again in a moment.';
      }
    },
  };
}
