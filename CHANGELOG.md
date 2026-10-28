# Changelog

Versions follow [semantic versioning](https://semver.org/). Raising the version in package.json releases it: the build publishes the image, then tags the commit and creates a GitHub release from this file. Each release is a git tag (`v0.2.0`) and a container image tag (`ghcr.io/nathanapples/shelfhelp:0.2.0`, plus `:0.2` for the latest patch of that minor). `:latest` follows `main`.

## 0.11.0 (2026-10-28)

- Default Discover rows trimmed to: Top picks for you, Trending on Hardcover, Pick up where you left off, From your Want to Read, Recent releases, Recently added, New from authors you listen to, Highest rated new books. Your recent requests, Upcoming releases, the featured prompt and the genre rows are no longer defaults (they can still be added in Customize).
- Genres are now Hardcover's top 10 by number of books: Fiction, Fantasy, Young Adult, Adventure, Science Fiction, Comics, Classics, History, Romance, LGBTQ. Genre rows saved before keep working.
- New moods line under genres, with Hardcover's top 10 moods: Adventurous, Emotional, Dark, Mysterious, Tense, Funny, Reflective, Lighthearted, Sad, Hopeful. Each opens the most-read books with that mood, and moods can be added as Discover rows.
- Genres and moods have arrow buttons, so they scroll on small screens too.
- "Customize this page" is now at the bottom of Discover.

## 0.10.0 (2026-10-28)

- Discover follows Hardcover's own Discover page. New default order: Top picks for you, Trending on Hardcover, Pick up where you left off, From your Want to Read, Recent releases, Upcoming releases, Recently added, New from authors you listen to, the featured prompt, Top Fantasy, Top Science Fiction, Highest rated new books, Your recent requests. If you've saved your own rows, use "Use the defaults" in Customize to get this order, or add the new rows yourself.
- New rows: Pick up where you left off (the next unread book in series you've read lately, from your Hardcover shelves) and Hardcover's featured prompt (titled with its question, most picked books first).
- Trending on Hardcover now covers the last three months, like Hardcover. Recent releases are the most popular books from the last three months, and Upcoming releases are the most anticipated books of the next year.
- "Recommended for you" is now "Top picks for you".
- Sign out sits next to your profile in the sidebar instead of next to the search bar.
- Genre chips are no longer cut off at the top, and Customize sits on the same line as them.
- Tighter spacing between Discover rows and between books.

## 0.9.0 (2026-10-28)

- Discover: posters are about a third smaller, so more fit on screen.
- Every Discover row links to its own page (tap the title or See all) with a bigger set of its books, up to 60 (200 for Hardcover lists).
- New "Recommended for you" row: books from your vibes on Hardcover that aren't in Audiobookshelf yet. It uses your own Hardcover account, and stays empty until Hardcover has made your vibes (open them once on hardcover.app).
- Genres: a row of genre chips at the top of Discover opens the most-read books on Hardcover in that genre (Fantasy, Science Fiction, Mystery, Thriller, Romance, Horror and more). Genres can also be added as Discover rows in Customize. New installs get Recommended for you, Top Fantasy and Top Science Fiction rows by default.
- Requesting a book and closing its popup before the answer comes back no longer opens the popup again. The message still shows.

## 0.8.0 (2026-10-28)

- Library: tabs for each Audiobookshelf library (for example Audiobooks), so you can look at just one. The counts and filters follow the tab, and your pick is remembered.
- Requests: "Advanced: pick a specific edition" in the book popup lists the book's editions from Hardcover (narrator, publisher, year, length, ASIN or ISBN). The picked edition is the one Chaptarr is asked for. If Chaptarr doesn't list it, or already has the book, Chaptarr keeps its own pick and the request says so. The edition shows on the Requests page and is kept when you retry.
- Requests page: click a book's cover or title to open the same popup as Discover.
- The Issues tab now sits above Reading.
- Reading: books under the minimum no longer count against the in sync percentage, and each reader's card shows how many books are Did Not Finish.

## 0.7.1 (2026-10-28)

- Shelfhelp no longer touches Audiobookshelf tags at all, including the one-time cleanup of the old "Requested by" tags. Remove any leftovers in Audiobookshelf yourself.

## 0.7.0 (2026-10-28)

- Requests are tagged in Chaptarr, not Audiobookshelf. Shelfhelp no longer writes tags to Audiobookshelf, and it removes the "Requested by" tags it added before (only those exact tags; your own tags stay).
- Chaptarr gets a tag per requester (their username by default), like Seerr does in Sonarr and Radarr. Chaptarr keeps tags on authors, per format, so the tag goes on the requested book's author. Turn it off or change the tag in Settings, Chaptarr.

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
