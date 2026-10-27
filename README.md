# Shelfhelper

Keeps [Audiobookshelf](https://www.audiobookshelf.org/) collections in step with your [Hardcover](https://hardcover.app) lists, with a web UI modeled on Seerr.

Add a Hardcover list, pick a library, and Shelfhelper creates a collection with every book from the list that you own. When the list changes, the collection follows.

## How matching works

Library metadata is often messy, and ASINs in particular are often wrong. So no single signal decides a match:

- **ID match:** the item's ASIN or ISBN points to the Hardcover book (through any edition, or Hardcover's Audible/Amazon ID mappings). This only counts when the title and author agree with it.
- **Title and author:** compared after stripping things like "(Unabridged)", "[Dramatized Adaptation]", "Book 1", series prefixes ("Mistborn: The Final Empire") and "Last, First" names.
- **Series and length:** a different number in the same series counts heavily against a match (so *Dune* never matches *Dune Messiah*); matching length helps a little.

Each book on a list ends up as one of:

| Status | What happens |
|---|---|
| **In Library** | Confident match. Added to the collection. |
| **Needs Review** | Possible match (for example an ASIN that points to a book whose title disagrees). Never added until you approve it. |
| **Not in Library** | Nothing close enough. |
| **Ignored** | You told Shelfhelper to skip it. |

Your decisions (approve, pick a different item, not mine, ignore) are remembered per book and library, so they apply to every list and survive future syncs.

## Install

Create a `docker-compose.yml`:

```yaml
services:
  shelfhelper:
    image: ghcr.io/nathanapples/shelfhelper:latest
    container_name: shelfhelper
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=America/Denver
    volumes:
      - /apps/shelfhelper:/config
    ports:
      - 5075:5075
    restart: unless-stopped
```

Then `docker compose up -d` and open `http://<host>:5075`. Settings asks for:

1. **Hardcover API token** from [hardcover.app/account/api](https://hardcover.app/account/api).
2. **Audiobookshelf URL and API key.** Create a key in Audiobookshelf under Settings, API Keys, for a user that can update (an admin is simplest). If both containers share a Docker network, the URL can be `http://audiobookshelf:80`.

To update: `docker compose pull && docker compose up -d`.

### Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PUID` / `PGID` | 1000 | User and group the app runs as |
| `TZ` | UTC | Time zone |
| `UMASK` | (system) | Optional, e.g. `002` |
| `APP_PASSWORD` | unset | Require a password to open the web UI |
| `HARDCOVER_TOKEN` | unset | Pins the Hardcover token instead of setting it in the UI |
| `ABS_URL` / `ABS_TOKEN` | unset | Pins the Audiobookshelf connection |
| `SYNC_INTERVAL_MINUTES` | 360 | Pins the sync schedule (0 turns it off) |
| `PORT` | 5075 | Port inside the container |

Everything Shelfhelper keeps (settings, lists, decisions, the library snapshot) lives in `/config/shelfhelper.db`.

## Roadmap

- Requests: send books that are not in your library to Chaptarr.
- Per-user read status sync between Audiobookshelf and Hardcover.

## Development

```bash
npm install
npx tsx test/mock-servers.ts      # fake Hardcover + Audiobookshelf on :5091 / :5092
HARDCOVER_ENDPOINT=http://localhost:5091/v1/graphql HARDCOVER_TOKEN=x \
  ABS_URL=http://localhost:5092 ABS_TOKEN=x CONFIG_DIR=./config npm run dev:server
npm run dev:web                   # http://localhost:5173
npm test                          # matcher tests
```

Built with the official [Hardcover TypeScript SDK](https://github.com/hardcoverapp/hardcover-sdk), Fastify, React and Tailwind. The GitHub Action in `.github/workflows/docker.yml` publishes `ghcr.io/nathanapples/shelfhelper` (amd64 and arm64) on every push to `main`.

## License

MIT
