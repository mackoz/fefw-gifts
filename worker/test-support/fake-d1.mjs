// A D1-shaped stand-in. It records every statement and returns canned results
// in order; it does not execute SQL. These tests are about which statements the
// store issues and what it does with the rows that come back, not about
// SQLite's behaviour -- that belongs to Cloudflare.
export function fakeD1(responses = []) {
  const queue = [...responses];
  const calls = [];

  const execute = (sql, params) => {
    calls.push({ sql, params });
    return Promise.resolve(queue.shift() ?? { results: [], meta: { changes: 0 } });
  };

  return {
    calls,
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...args) { params = args; return statement; },
        all: () => execute(sql, params),
        run: () => execute(sql, params),
        first: () => execute(sql, params).then((result) => result.results?.[0] ?? null),
      };
      return statement;
    },
  };
}
