# calendar project

A tiny personal sync backend for the calendar PWA. It exists to solve one
problem: get events from your phone's browser to your desktop's browser (and
back) without going through Google/Samsung/Apple's calendar apps.

No database, no user accounts. Events live in a single JSON file
(`data/events.json`) and every request is authenticated with one shared
bearer token. This is not built to serve multiple people — it's a private
endpoint for your own two (or more) devices.

Sync is last-write-wins per event, keyed by id, compared on an `updatedAt`
timestamp. Deletes are soft (tombstoned) so they actually propagate instead
of a stale copy reappearing on the other device next sync.

## Run it locally

```bash
cp .env.example .env
```

Open `.env` and replace `SYNC_TOKEN` with something you generated, not
something you typed:

```bash
openssl rand -hex 24
```

Then:

```bash
npm install
npm start
```

Check it came up:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"time":1234567890123}
```

## Deploying on Railway

This is what actually worked, including the parts that didn't work the
first time.

1. **Push this folder to a GitHub repo.** If it's a subfolder of a bigger
   repo (e.g. you keep the PWA in the same repo), note the path — you'll
   need it in step 3.

2. **New Project → Deploy from GitHub repo**, pick the repo.

3. **If Railway can't find anything to build** (build log says something
   like *"Railpack could not determine how to build the app"* and only
   lists `README.md`), it means it's looking at the repo root and your
   `package.json`/`Dockerfile` are in a subfolder. Go to the service's
   **Settings → Source → Root Directory** and point it at that subfolder.

4. **Build should pick up the Dockerfile automatically** (Settings →
   Build → Builder should say "Dockerfile"). If you get
   `dockerfile invalid: docker VOLUME ... not supported, use Railway Volumes`
   — that's why this repo's `Dockerfile` has no `VOLUME` line. Railway
   doesn't support the Docker `VOLUME` instruction; volumes are attached
   through their own UI instead (next step). If you're looking at an older
   copy of this Dockerfile with `VOLUME ["/data"]` in it, delete that line.

5. **Attach a volume.** This is not under Settings, and it's not a "New"
   service type either — it's a right-click. Go back to the project
   canvas, right-click (or use the "···" menu on) the service card itself,
   and pick **Attach Volume**. Mount path: `/data`. Skip this and your
   `events.json` gets wiped on every redeploy.

6. **Variables tab**, add:
   - `SYNC_TOKEN` — the token you generated earlier
   - `DATA_DIR` — `/data` (has to match the mount path from step 5)

7. **Settings → Networking → Generate Domain** to get a public HTTPS URL.
   Something like `https://calendar-production-xxxx.up.railway.app`.

8. Sanity check before touching the app:
   ```
   https://<your-domain>/api/health
   ```
   should return `{"ok":true,...}`. If you instead see the deploy log
   spamming `ERROR: SYNC_TOKEN is not set` in a loop, the Variable didn't
   make it into the running container — double check it's set on the
   right environment and hit Redeploy from the Deployments tab.

Point the app's sync settings at the domain from step 7 (no trailing
slash, no `/api/health`) and the token from step 6.

## Other ways to run this

Railway is the path of least resistance, but there's nothing
Railway-specific in the code — it's a plain Dockerized Node app that reads
`PORT`, `SYNC_TOKEN`, and `DATA_DIR` from the environment. Anywhere that
gives you a persistent volume and lets you set env vars will work.

**Fly.io**
```bash
fly launch
fly volumes create calendar_data --size 1
# add to fly.toml:
#   [mounts]
#   source = "calendar_data"
#   destination = "/data"
fly secrets set SYNC_TOKEN=<your token>
fly deploy
```

**Your own VPS**
```bash
docker build -t calendar-sync .
docker run -d --name calendar-sync \
  -p 3000:3000 \
  -e SYNC_TOKEN=<your token> \
  -e DATA_DIR=/data \
  -v $(pwd)/data:/data \
  calendar-sync
```
Put this behind Caddy or nginx for TLS. Don't run it over plain HTTP — the
token goes over the wire on every request.

## API

Every route except `/api/health` requires:
```
Authorization: Bearer <SYNC_TOKEN>
```

**`GET /api/health`**
No auth. Returns `{ ok: true, time: <ms> }`.

**`GET /api/events?since=<ms>`**
Dump of everything changed after `since`. Mostly useful for poking at the
server with curl when something looks wrong.

**`POST /api/sync`**
The actual sync call.

Request:
```json
{ "since": 1719999999999, "changes": [ { "...": "event object with an updatedAt" } ] }
```

Response:
```json
{ "serverTime": 1720000000000, "events": [ "...everything changed since `since`, post-merge" ] }
```

Merge rule: whichever copy of an event has the higher `updatedAt` wins.
Deletes show up as an event object with `deleted: true` — that's how the
other device knows to remove it instead of just never hearing about it
again.

## Connecting the app

In the PWA, open the sync settings panel and set:
- Server URL: `https://<your-domain>` (no trailing slash)
- Token: the `SYNC_TOKEN` value from step 6 above

Do this once per device. After that the app pushes changes on its own
(debounced ~1s after you edit something) and pulls every ~25s while the
tab is open.