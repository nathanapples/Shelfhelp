# Changelog

Versions follow [semantic versioning](https://semver.org/). Raising the version in package.json releases it: the build publishes the image, then tags the commit and creates a GitHub release from this file. Each release is a git tag (`v0.2.0`) and a container image tag (`ghcr.io/nathanapples/shelfhelp:0.2.0`, plus `:0.2` for the latest patch of that minor). `:latest` follows `main`.

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
