# Shelfhelp

Keeps [Audiobookshelf](https://www.audiobookshelf.org/) collections in step with your [Hardcover](https://hardcover.app) lists, sends your Audiobookshelf listening progress to Hardcover, and requests books through [Chaptarr](https://github.com/Chaptarr/chaptarr), with a web UI modeled on Seerr.

## AI DISCLOSURE

THIS IS VIBE CODED. I DO NOT RECOMEND ANYONE EXPOSE THIS TO THE INTERNET DIRECTLY. My solution has been to put it behind a cloudflare authentication page which authenticates with my Pocket ID.

Although this is publicly listed, this is for my personal use. Given that this is vibe coded and its for my personal use, I make no promises things will be fixed. All that said it works pretty well for me, my homelab, and users.

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
| **Ignored** | You told Shelfhelp to skip it. |

Your decisions (approve, pick a different item, not mine, ignore) are remembered per book and library, so they apply to every list and survive future syncs.

## Reading progress

The Reading page sends your Audiobookshelf listening progress to Hardcover:

- A book you've started becomes **Currently Reading** with your progress.
- A book you've finished becomes **Read** with the finish date.
- Missing reading dates are filled in from Audiobookshelf (start = first played, finish = finished). Dates already on Hardcover are never changed.
- It only moves forward. Read stays Read, Did Not Finish is never touched, and progress is never lowered.
- Books under 5% listened (adjustable) are left out.

Nothing is sent until you send it. Changes wait on the Reading page; **Review and send** shows the exact list with a checkbox for each. Every change that's sent is kept in **History**, where it can be undone: a book Shelfhelp added is removed, a status change is set back, and a progress update is reverted. If you'd rather not approve each batch, turn on **Send automatically** with the gear button on the Reading page.

Other options there: mark synced books as Owned, and pick libraries.

When Hardcover lists the same book twice, the copy already on your shelves is used. **Match again** on a book forgets its match and looks it up fresh.

Matching is shared with collections. Audiobookshelf items are matched to Hardcover books by ASIN/ISBN, by your collections, and by a Hardcover search, using the same rules. A match you make in either place applies to both.

Progress comes from the Audiobookshelf user whose API key Shelfhelp uses. Every book library is used unless you uncheck it; podcast libraries are never used.

Some of these rules follow [ShelfBridge](https://github.com/rohit-purandare/ShelfBridge) and [audiobookshelf-hardcover-sync](https://github.com/drallgood/audiobookshelf-hardcover-sync).

## Discover

The home page. Rows of trending books, new releases, the highest rated new books, new books from authors already in your library, what's coming soon, books on your Want to Read shelf that aren't in Audiobookshelf yet, what was recently added, and any Hardcover lists you add. A check mark means you already have it; tap any book for its Hardcover rating, what's in Audiobookshelf, and to request it.

Customize sets which rows you see and in what order. Admins can save their rows as everyone's default; anyone can pick their own.

## Issues

Anyone can report a problem with a book from its popup, choosing a kind (audio, missing chapters, wrong book, details or cover, something else) and saying what's wrong. Everyone can see issues on the Issues page and comment while they're open. Admins resolve them (with a comment if they like) and can delete them; anyone can reopen a resolved issue if it isn't fixed.

## Library

Links every Audiobookshelf book to its Hardcover book, using the same matching as Reading and Collections. It runs after each sync and only looks up books that are new or changed, paced to stay inside Hardcover's rate limit. Discover, search and the book popup use these links to tell you what you already have. An ASIN or ISBN match only counts when the titles agree, so a mislabeled ASIN can't hide a book you don't own. Books that need a look are under Check, and you can link any book by hand.

## Requests (Chaptarr)

Connect [Chaptarr](https://github.com/Chaptarr/chaptarr) in Settings, Chaptarr, then turn Requests on. Search for a book or paste a hardcover.app link into the search bar and request it as an audiobook (the default), an ebook, or both.

- Books are found in Chaptarr by their Hardcover id (`hc:123`), not by title.
- Only the requested book is monitored. A new author is added with nothing else monitored and no new books followed.
- A book Chaptarr already has but isn't monitoring is switched on and searched; one it already downloaded is just marked Downloaded.
- Root folder and profiles default to whatever the root folder is set to in Chaptarr; you can pick others per format.
- Requests move through Requested, Downloading and Downloaded. Audiobooks become Available once they show up in Audiobookshelf. Shelfhelp checks every few minutes.
- Each request tags the book's author in Chaptarr with who asked for it (for example `sage`), like Seerr does in Sonarr and Radarr. Chaptarr keeps tags on authors, not single books. Nothing is written to your files or to Audiobookshelf.
- Collections can come from requests too: one person's or everyone's, filled in as the books arrive.
- The Chaptarr tab has a read-only lookup tester that shows exactly what Chaptarr returns, for checking the connection without adding anything.

## Install

Create a `docker-compose.yml`:

```yaml
services:
  shelfhelp:
    image: ghcr.io/nathanapples/shelfhelp:latest
    container_name: shelfhelp
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=America/Denver
    volumes:
      - /apps/shelfhelp:/config
    ports:
      - 5075:5075
    restart: unless-stopped
```

Then `docker compose up -d` and open `http://<host>:5075`. Settings asks for:

1. **Hardcover server key** from [hardcover.app/account/api](https://hardcover.app/account/api). It's Shelfhelp's own key for shared data (trending, genres, book details, public lists) and never reads anyone's shelves. Ideally make it on a Hardcover account just for Shelfhelp, with only `read:catalog`, `read:lists` and `read:prompts`.
2. **Audiobookshelf URL and API key.** Create a key in Audiobookshelf under Settings, API Keys, for a user that can update (an admin is simplest). If both containers share a Docker network, the URL can be `http://audiobookshelf:80`.

To update: `docker compose pull && docker compose up -d`.

### Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PUID` / `PGID` | 1000 | User and group the app runs as |
| `TZ` | UTC | Time zone |
| `UMASK` | (system) | Optional, e.g. `002` |
| `APP_PASSWORD` | unset | With no sign-in, a password to open the web UI. With Pocket ID or Cloudflare, an emergency admin sign-in |
| `AUTH_MODE` | none | `none`, `oidc` (Pocket ID) or `cloudflare`. Set `none` here to get back in if sign-in breaks |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | unset | Pocket ID (or any OpenID Connect provider) |
| `OIDC_INTERNAL_URL` | unset | How the container reaches the provider, if not by its public address |
| `OIDC_ADMIN_GROUP` | unset | Provider group whose members are Shelfhelp admins |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | unset | Cloudflare Access team domain and application AUD tag |
| `HARDCOVER_TOKEN` | unset | Pins the Hardcover server key instead of setting it in the UI |
| `HARDCOVER_CLIENT_ID` / `HARDCOVER_CLIENT_SECRET` | unset | Pins the Hardcover developer app used for Sign in with Hardcover |
| `ABS_URL` / `ABS_TOKEN` | unset | Pins the Audiobookshelf connection |
| `CHAPTARR_URL` / `CHAPTARR_API_KEY` | unset | Pins the Chaptarr connection |
| `SYNC_INTERVAL_MINUTES` | 360 | Pins the sync schedule (0 turns it off) |
| `PORT` | 5075 | Port inside the container |

Everything Shelfhelp keeps (settings, lists, decisions, the library snapshot) lives in `/config/shelfhelp.db`.

## Users and sign-in

Everyone who uses Shelfhelp is an Audiobookshelf user. The owner is the Audiobookshelf user whose API key Shelfhelp uses (give it an admin key so Shelfhelp can see other users' listening progress). Audiobookshelf admins are Shelfhelp admins; everyone else is a reader, who sees Discover, their own Requests, their own Reading, and My account. Everyone, the owner included, connects their own Hardcover account under My account, either with **Connect with Hardcover** or by pasting an API key; an admin can also add someone as a reader from the Reading page.

**Sign in with Hardcover:** on hardcover.app, open Account, then Developer apps, and make a web app. Use the redirect link shown in Settings, Hardcover (`https://<your address>/api/hardcover/oauth/callback`), then put the app's client ID and secret in Settings. Shelfhelp keeps each person's tokens and renews them on its own. Hardcover has no app-only access, so the server key above is still what Discover uses for shared data.

Pick how people sign in under Settings, Users:

- **No sign-in** (default): everyone is the owner. `APP_PASSWORD` asks for a password first.
- **Pocket ID**: create an OIDC client in Pocket ID with the callback URL Settings shows (`https://<shelfhelp address>/api/auth/oidc/callback`; add one per address you use), then enter the issuer URL, client ID and secret. People are matched to their Audiobookshelf account by verified email, then username, the same way Audiobookshelf links Pocket ID accounts. Works behind Cloudflare Access too.
- **Cloudflare Access**: put Shelfhelp behind a Cloudflare Access application and enter the team domain and AUD tag. Shelfhelp verifies the signed token Cloudflare adds to every request and matches the email to an Audiobookshelf account, so there's one login. It can only be turned on from a page opened through Cloudflare, as an admin, so you can't lock yourself out.

If you can't sign in, press "Can't sign in?" on the login page: a one-time admin sign-in link appears in the container log (`docker logs shelfhelp`), good for 15 minutes. `APP_PASSWORD` also works as an emergency admin sign-in, and `AUTH_MODE=none` on the container turns sign-in off.

## Versions

Each release is tagged, and the image is published with its version. Use `ghcr.io/nathanapples/shelfhelp:0.2` to get fixes for 0.2 without jumping to 0.3, a full version like `:0.2.0` to stay put, or `:latest` to follow every change. What changed is in [CHANGELOG.md](CHANGELOG.md). The running version is shown at the bottom of the sidebar.

## Development

```bash
npm install
npx tsx test/mock-servers.ts      # fake Hardcover, Audiobookshelf, Chaptarr on :5091 / :5092 / :5093
HARDCOVER_ENDPOINT=http://localhost:5091/v1/graphql HARDCOVER_TOKEN=x \
  ABS_URL=http://localhost:5092 ABS_TOKEN=x \
  CHAPTARR_URL=http://localhost:5093 CHAPTARR_API_KEY=chaptarr-key CONFIG_DIR=./config npm run dev:server
npm run dev:web                   # http://localhost:5173
npm test
```

Built with the official [Hardcover TypeScript SDK](https://github.com/hardcoverapp/hardcover-sdk), Fastify, React and Tailwind. The GitHub Action in `.github/workflows/docker.yml` publishes `ghcr.io/nathanapples/shelfhelp` (amd64 and arm64) on every push to `main`.

## License

MIT
