// The search box re-renders the whole view, which on the matrix route means
// re-deriving 4,240 pairs and rebuilding as many cells. At one render per
// keypress a fast typist queues a dozen full rebuilds to reach a three-letter
// query. Trailing-edge only: the last keystroke is the one worth rendering.
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
