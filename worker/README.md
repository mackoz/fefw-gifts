# The submissions Worker

A Cloudflare Worker and a D1 database holding anonymous gift-result reports
until a maintainer approves them into `data/observations.json`. The published
site works without it; nothing here is required to read the guide.

## What it stores

One table, `reports` (see `schema.sql`). It holds the report content, a status,
two vote counters and a timestamp. It holds **no** name, email, IP address,
hashed IP, session id or any other identifier, and Turnstile is called without
`remoteip`. Adding an identifying column is a design change, not a fix.

## Endpoints

| Route | Access | Purpose |
|---|---|---|
| `POST /report` | Turnstile | Insert a pending row. |
| `POST /vote` | Turnstile | Increment one counter on a pending row. |
| `GET /pending` | Public | Pending rows for the site overlay, **without vote counts**. |
| `GET /review` | Admin token | Pending rows **with** vote counts, best score first. |
| `POST /review/:id` | Admin token | `{"decision":"approve"}` or `{"decision":"reject"}`. |
| `POST /ingest` | Admin token | Return approved rows and mark them ingested. |

Vote counts are never selected by `GET /pending`. That is enforced in the SQL in
`src/reports.js`, not in the UI, and a test asserts it. Do not add them.

## First-time setup

1. **Create the database**

   ```sh
   npx --yes wrangler d1 create fefw-gifts
   ```

   Copy the printed `database_id` into `wrangler.toml`.

2. **Create the table**

   ```sh
   npx --yes wrangler d1 execute fefw-gifts --remote --file worker/schema.sql --config worker/wrangler.toml
   ```

3. **Create a Turnstile widget** in the Cloudflare dashboard
   (Turnstile → Add widget), with the hostname `mackoz.github.io`. Keep both
   keys: the **site key** is public and goes in `assets/js/config.js`; the
   **secret key** is a Worker secret.

4. **Generate an admin token** — long and random, never reused:

   ```sh
   node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
   ```

5. **Set the secrets** (they are prompted for, never passed as arguments, so
   they stay out of your shell history):

   ```sh
   npx --yes wrangler secret put TURNSTILE_SECRET --config worker/wrangler.toml
   npx --yes wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml
   ```

6. **Deploy**

   ```sh
   npm run worker:deploy
   ```

   Note the `https://….workers.dev` URL it prints.

7. **Point the site at it** — put the Worker URL and the Turnstile site key in
   `assets/js/config.js` and commit. Until you do, the site runs in its
   no-submissions mode and everything else works normally.

8. **Add the GitHub Actions secrets** — in the repository's
   Settings → Secrets and variables → Actions, add `WORKER_URL` and
   `ADMIN_TOKEN` (the same token as step 4). The nightly sync job needs both.

## Reviewing

Open `https://mackoz.github.io/fefw-gifts/review/`, paste the admin token once,
and approve or reject. The page is not linked from the site and carries
`noindex`, but it is not secret: everything on it comes from the admin-gated
endpoints, so without the token it shows nothing.

**Known limitation, accepted deliberately.** The token sits in `localStorage` on
a public origin, so anyone holding it can approve anything. For a single
maintainer that is a reasonable trade. Keep it long and random, only ever use it
over HTTPS, and rotate it if it leaks:

```sh
npx --yes wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml   # set the new value
```

then update the `ADMIN_TOKEN` Actions secret and clear the old token from the
review page. Putting Cloudflare Access in front of `/review` is the upgrade path
if this stops being acceptable.

## The ingest trade-off

`POST /ingest` returns the approved rows **and marks them ingested in the same
call**. That means any failure *after* the call returns -- the merged dataset
failing validation, `git push` failing, `gh pr create` failing, or the
resulting pull request being closed without merging -- leaves those rows
gone from D1 with nothing else to show for it, and they have to be re-entered
by hand.

`scripts/ingest.mjs` prints the fetched rows (`console.log(JSON.stringify(rows,
null, 2))`) before it does anything that can fail, specifically so they are
recoverable in that case: open the failed GitHub Actions run for
`sync-reports.yml`, find that log line, and re-enter the rows by hand (or
re-run the merge locally against the logged JSON). The log is visible only to
people with access to the repository.

## Local development

```sh
npx --yes wrangler dev --config worker/wrangler.toml
```

Point `assets/js/config.js` at `http://127.0.0.1:8787` and add that origin to
`ALLOWED_ORIGINS` in `wrangler.toml` while you work. Revert both before
committing.
