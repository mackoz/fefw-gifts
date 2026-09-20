import { el } from './views/shared.js';
import { votedDirection } from './votes.js';

const BEFORE = 'A player reported this. Does it match what you have seen?';
const AFTER = 'Thanks — noted for the maintainer.';

// Pure. Deliberately reads only `report.id` from the row: even if a future
// endpoint change started returning counts, none could reach the page through
// here. No tally, score or count may ever appear in this model.
export function voteControlModel(report, storage) {
  const direction = votedDirection(storage, report.id);
  return {
    reportId: report.id,
    voted: direction !== null,
    direction,
    prompt: direction === null ? BEFORE : AFTER,
  };
}

export function voteControl(model) {
  const wrapper = el('div', 'vote-control');
  wrapper.append(el('span', 'vote-prompt', model.prompt));
  if (model.voted) return wrapper;

  for (const [direction, label] of [['up', 'Matches'], ['down', 'Doesn’t match']]) {
    const button = el('button', 'vote-button', label);
    button.type = 'button';
    button.dataset.report = model.reportId;
    button.dataset.direction = direction;
    wrapper.append(button);
  }
  return wrapper;
}
