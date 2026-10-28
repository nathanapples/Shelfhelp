# Changelog

Versions follow [semantic versioning](https://semver.org/). Raising the version in package.json releases it: the build publishes the image, then tags the commit and creates a GitHub release from this file. Each release is a git tag (`v0.2.0`) and a container image tag (`ghcr.io/nathanapples/shelfhelp:0.2.0`, plus `:0.2` for the latest patch of that minor). `:latest` follows `main`.

## 0.6.1 (2026-10-28)

- Issues: readers can comment only while an issue is open, and anyone can reopen a resolved issue (with a comment if they like). Admins can comment any time and resolve with a comment in one step.

## 0.6.0 (2026-10-28)

- Issues: anyone can report a problem with a book from its popup (audio, missing chapters, wrong book, details, other) and comment on any issue. Admins can resolve, reopen and delete. New Issues page with open, resolved and all views; open issues show on the book too.
- Requests: views are dropdowns, open on Failed, and remember where you left them. The description and Check Chaptarr button are gone (requests are still checked every few minutes).

## 0.5.0 (2026-10-28)

- Discover is customizable. Customize picks, orders and removes rows; anyone can set their own, and admins can save theirs as everyone's default.
- New Discover rows: Trending this week, Highest rated new books, New from authors you listen to, and Popular audiobooks. Any public Hardcover list can be a row too.
- Book popups show the Hardcover rating.
- "Same book" and linking are admin-only. Linking shows an Undo, and linked books have a "Not the same book" button (also in Library as "Not this book") that unlinks them everywhere and stops them being linked again. Unlinking has its own Undo.

## 0.4.2 (2026-10-28)

- "Can't sign in?" on the login page writes a one-time admin sign-in link to the container log (`docker logs shelfhelp`). It works once, for 15 minutes.

## 0.4.1 (2026-10-28)

- Pocket ID: pasting the full `.well-known/openid-configuration` link as the issuer URL now works.

## 0.4.0 (2026-10-28)

- Requested books are tagged in Audiobookshelf with who asked for them ("Requested by sage"), like Seerr tags requests in Sonarr and Radarr. Existing tags are kept, and the wording can be changed under Settings, Chaptarr.
- New Collection has a Requests section: make a collection from one person's requests or everyone's. Books join as they arrive in Audiobookshelf.

## 0.3.0 (2026-10-28)

- Users. Sign in with Pocket ID (or any OpenID Connect provider) or through Cloudflare Access, or keep no sign-in. People are matched to their Audiobookshelf accounts by email, then username. Audiobookshelf admins are admins here.
- Readers see Discover, their own requests, their own reading and My account. Admins see everything.
- Reading sync is per person: each reader's Audiobookshelf progress goes to their own Hardcover account, with their own options and history. Your existing reading data stays yours.
- Admins can add a reader (an Audiobookshelf user plus their Hardcover token) from the Reading page, and manage roles under Settings, Users.
- Requests show who asked; each person sees the ones they asked for.
- `APP_PASSWORD` is an emergency admin sign-in when Pocket ID or Cloudflare is on. `AUTH_MODE=none` turns sign-in off from the container.
- Signing in again is needed once after upgrading.

## 0.2.0 (2026-10-28)

- Discover is the new home page: trending, new releases, coming soon, popular this year, your Want to Read books you don't own yet, recently added, recent requests.
- Requests through Chaptarr: request a book as an audiobook, ebook or both from search, Discover or a pasted Hardcover link. Only that book is monitored. Requests are tracked until they're Available in Audiobookshelf.
- Library: links every Audiobookshelf book to Hardcover in the background, so Shelfhelp can tell what you already have. Book popups show your copy or close matches.
- An ASIN or ISBN match only counts as owned when the titles agree.
- Reading opens on an overview with a card per reader.
- Collections no longer shows overall totals; each collection has its own breakdown.
- The search bar accepts hardcover.app links and `hc:` ids.

## 0.1.0

- Collections: Hardcover lists and shelves kept in step with Audiobookshelf collections.
- Reading: Audiobookshelf listening progress and dates sent to Hardcover, with review before sending, history and undo.
