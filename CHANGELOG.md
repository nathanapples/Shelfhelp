# Changelog

Versions follow [semantic versioning](https://semver.org/). Raising the version in package.json releases it: the build publishes the image, then tags the commit and creates a GitHub release from this file. Each release is a git tag (`v0.2.0`) and a container image tag (`ghcr.io/nathanapples/shelfhelp:0.2.0`, plus `:0.2` for the latest patch of that minor). `:latest` follows `main`.

## 0.33.0 (2026-11-10)

- New: an Audiobookshelf link on each book in the Library page and in Reading, next to the Hardcover link, that opens the book in Audiobookshelf. Set where you open Audiobookshelf in your browser in Settings, Audiobookshelf, Address for links (or `ABS_PUBLIC_URL`). It's separate from the server URL Shelfhelp uses, and the server URL is used when it's empty.
- Fixed: a book matched on someone's Reading page (for example with Match again) now shows as linked on the Library page right away, instead of only after the next library sync. Books you've already linked, marked or ignored on the Library page are left alone.

## 0.32.1 (2026-11-10)

- Fixed: after you fix a book's title or author in Audiobookshelf, Sync now on the Library page (and Link again) uses the fix right away. Before, it could reuse what it had read from Audiobookshelf in the last 30 minutes, so the old author kept being compared until later.

## 0.32.0 (2026-11-10)

- Reading: each book's details now show its reading dates in Audiobookshelf and on Hardcover side by side, so you can see which one is missing. Before, only the Audiobookshelf date was shown, which made a waiting date change look like the dates already matched.
- Waiting date changes say what they do, for example "Add start date Aug 24, 2026 from Audiobookshelf (Hardcover has none)". Dates are written out instead of 2026-08-24.
- New Reading setting, Fill in reading dates (on by default): adds start and finish dates from Audiobookshelf where Hardcover doesn't have them. Dates already on Hardcover are never changed. Turn it off and Shelfhelp sends no dates at all, so books that only needed a date count as in sync.

## 0.31.1 (2026-11-10)

- After you update Shelfhelp, the app now loads the new version by itself instead of showing "Shelfhelp was updated" with a Reload button. It reloads when you come back to the app, or while it's in the background, so nothing you're in the middle of is cut off.

## 0.31.0 (2026-11-10)

- New: Shelfhelp can go on your phone's home screen and open like an app, full screen without the browser bars, with its own icon.
  - My account has a "Shelfhelp on your phone" card with the steps for your phone, and an Install button where the browser offers one (Chrome on Android and computers). The card hides once you open Shelfhelp from the home screen.
  - Works behind a login page like Cloudflare Access with no changes there: the browser sends your sign-in when it fetches the app's details. On an iPhone the home screen icon may still come out as a plain letter or a screenshot behind such a login; the app itself works either way.
  - Inside the installed app you sign in once more, because phones keep the app's sign-in separate from the browser's.
  - When you update Shelfhelp, the open app notices and shows "Shelfhelp was updated" with a Reload button, since an installed app has no reload button of its own (0.31.1 reloads by itself instead).
  - If the server can't be reached, the app shows a short "Can't reach Shelfhelp" page with Try again instead of a blank screen. Pages and data always come from the server; only the app's own files are kept on the phone.
  - Long press the icon on Android for shortcuts to Requests and Reading.
- The header, side menu, popups and messages leave room for the notch and the home bar on phones.

## 0.30.0 (2026-11-10)

- New: Shelfhelp can be Audiobookshelf's Hardcover metadata provider, built in, with nothing extra to run. Turn it on in Settings, Audiobookshelf, under Hardcover metadata provider.
  - Each audiobook edition on Hardcover is its own match, with its narrator, length, audio publisher, ASIN, ISBN, language and cover, plus the book's title, author, description, series and genres (and moods as tags, if you want them). The most read edition comes first, which is what Quick Match uses.
  - Paste an ASIN or ISBN into Match's title box to get that exact edition first.
  - Books with no audiobook edition on Hardcover can still show up without narrator or length (on by default). A language setting keeps only editions in one language.
  - Shelfhelp adds itself to Audiobookshelf's custom metadata providers when you save (this needs Shelfhelp's Audiobookshelf key to be an admin's). A new key or address updates the entry there, and libraries using it as their default keep it.
  - Test asks Audiobookshelf to search through Shelfhelp, the way Match does, and says whether the problem is the address or the key. Try a search shows what Audiobookshelf would get.
  - Audiobookshelf has to reach Shelfhelp directly, for example `http://shelfhelp:5075` on the same Docker network, not through a login page like Cloudflare Access.
- Fixed: an Audiobookshelf reply with an empty body no longer causes an error.

## 0.29.0 (2026-11-10)

- Every Discover row stays full when you already own most of its books. Rows like Trending on Hardcover, genres, moods and new releases now fetch a bigger batch from Hardcover and keep up to 20 books you don't have, so the row and its full page match. Recently added is unchanged.
- Simpler order choices, now on every row (except Recently added): List order (on Hardcover lists) or Default (on other rows), Date, and Random. List order and Date have a button to flip the direction: top or bottom of the list first, newest or oldest first. Title and Author orders are gone; rows that used them go back to their default.
- Customize this page sets each row's default order, not just list rows.

## 0.28.0 (2026-11-09)

- List rows sort the whole Hardcover list, not just the books already shown. Before, a list row on Discover only held its first 30 books, and Newest first only reordered those 30, so a long list like award winners never showed its recent books. The full page now shows up to 500 books of a list.
- New **Random** order for list rows. The shuffle stays the same between a row and its full page until you reload.
- Customize this page: each Hardcover list row has a default order. Admins can save it as part of everyone's defaults. Picking an order on the row itself still works and is remembered in your browser; saving a new default in Customize replaces it.
- Top picks for you, From your Want to Read and list rows stay full when you already own most of their books. They now fetch enough books that you don't have, instead of a fixed number of which most were then hidden.

## 0.27.0 (2026-11-09)

- Reading uses the Library page's matches. A book already linked to Hardcover on the Library page is matched the same way on Reading (still preferring the copy on that reader's Hardcover shelves when Hardcover lists a book twice). Reading only searches Hardcover for books the Library page hasn't matched.
- With reading sync off, Shelfhelp still matches each reader's books and works out what would be sent, so the Reading page shows real Waiting and In sync counts instead of every book as an issue. Nothing is ever sent while it's off: sending is refused, the send buttons are hidden, and a note at the top says so. Check works while sync is off too.
- Books Shelfhelp hasn't looked up yet show as "Not checked yet" instead of "Not found on Hardcover", and don't count as issues.
- Library linking now runs before Reading on startup and on the schedule, so Reading gets the latest links.

## 0.26.0 (2026-11-09)

- Discover rows: the Show owned checkbox is now an eye button. An open eye shows books you already have in Audiobookshelf, a crossed out eye hides them. Hover over it to see "Show books in Audiobookshelf".
- The same eye is on each row's full page, and it shares its setting with the row on Discover.
- Top picks for you and From your Want to Read now have the eye too. They still hide books you already have unless you open the eye.
- Rows made from a Hardcover list have an order picker: List order, Newest first, Oldest first, Title or Author. It's remembered per row in your browser and shared with the row's full page.

## 0.25.0 (2026-10-30)

- New Collection: the search also finds Hardcover genres and moods. A genre or mood collection holds up to 100 books; whoever adds it picks **Top, all time** (the most-read books with that genre or mood) or **Trending this month** (what's popular in it now, so books come and go). Collections show them as Genre or Mood.
- A collection made from a public Hardcover list also becomes one of everyone's default Discover rows. People who picked their own rows keep theirs. List collections made before this version are added once when Shelfhelp starts; removing one from the defaults afterwards keeps it removed.

## 0.24.0 (2026-10-30)

- New Collection: your shelves and lists are one section (shelves first, then your lists, then the ones you follow). The link box is now a search box: type to filter your shelves, lists and requests, and to search all of Hardcover's public lists, the same way Add a row does. Pasting a list link still works.

## 0.23.0 (2026-10-30)

- Customize Discover: the Add a row search finds public lists from all of Hardcover, not just your own and the ones you follow. They show after your own matches, with who made each list and how many books it has. Pick one to add it as a row. Needs the server key's `read:social` (see 0.22.2).

## 0.22.2 (2026-10-30)

- The server key needs `read:social` to read other people's public lists, such as Hardcover's own. Without it, Hardcover only shows the key its own account's lists, so adding a row from someone else's list link failed with "wasn't found". The README and Settings now list it, and the key test checks for it.

## 0.22.1 (2026-10-30)

- Adding a row from a Hardcover list link works for anyone's public list. The link is now matched through Hardcover's list search, since Hardcover only lets a key look up lists by owner for its own account. The server key no longer needs `read:users`.
- A key pasted under My account is asked for `read:lists` too, for picking your own lists.

## 0.22.0 (2026-10-30)

- Settings, Hardcover: a new **API usage** panel shows how many requests the server key has used today out of the daily limit, the per-minute allowance and when the count resets, as Hardcover reports it with each answer. Each person's connection shows the same as last seen. The daily count is per Hardcover account, so it includes other apps and keys on that account.
- Browse lists and the All lists tab are removed again. Hardcover only lets a key read its own account's lists that way, so the section only ever showed the server account's lists.

## 0.21.0 (2026-10-30)

- Discover rows: "See all" is gone (the row title opens the full page). In its place, a small **Show owned** checkbox hides or shows books you already have in Audiobookshelf, remembered per row in your browser. It only appears on rows that have owned books.
- Browse by genre and Browse by mood: the section title opens All genres / All moods; the separate link at the top right is gone.
- New **Browse lists** section with Hardcover's most liked lists, each opening as its own page. Its title opens **All lists**: the top 30 lists, with a search for any other Hardcover list.
- Browse sections default to the top 15 genres, moods and lists. Customize this page has checkboxes to turn each section off, saved with your rows (and as everyone's default for admins). A saved chip list that was exactly the old top 20 now follows the new defaults.
- The sidebar groups are separated by lines without titles.

## 0.20.0 (2026-10-30)

- The sidebar is grouped: Requests (Discover, Requests, Issues), Sync (Reading, Collections) and Tools (Library), with Settings below.
- Settings has a separate **Authentication** tab for how people sign in. **Users** lists everyone with their Hardcover connection: signed in or API key, and whether it's active or not working (with the reason). Connections are checked at most hourly, or now with Check Hardcover now.
- "Can't sign in?" (a one-time admin link in the container log) is off unless `LOG_RECOVERY_LINK=true` is set on the container, and the link is hidden on the sign-in page when it's off.
- Library: the button says Sync now once the library has been linked, the library tabs no longer show scroll bars, and the progress bar is a single, quieter bar with the count of linked books.
- README trimmed, with screenshots. The mock servers now use public-domain books, and personal names and settings were taken out of the example and test data.

## 0.19.3 (2026-10-29)

- Settings, Hardcover: a Test button for Sign in with Hardcover checks the saved client ID and secret with Hardcover without anyone signing in, and shows Hardcover's answer for each way of sending the secret, plus the saved secret's length.
- Sign-in tries two more ways of sending the secret (Basic without form-encoding, and Basic with the client ID also in the form). When Hardcover refuses all of them, its exact answers go to the Activity log.

## 0.19.2 (2026-10-29)

- Sign in with Hardcover: Shelfhelp now sends the app's client secret the way the Hardcover app expects. It tries HTTP Basic first, falls back to sending it in the form, and remembers which one worked. Before, it only sent it in the form, which an app set up for Basic refuses with `invalid_client`.
- Clearer sign-in errors: a refused client ID or secret says to check both in Settings, Hardcover. Errors Hardcover sends back include its explanation.
- Test on the server key says plainly when Hardcover refuses the key itself (for example "Token is not associated with a user"), as opposed to a missing permission.

## 0.19.1 (2026-10-29)

- Test on the server key in Settings no longer fails for a key with only read:catalog, read:lists and read:prompts. It used to look up the key's Hardcover username, which needs read:me:content. It now checks what the server key is used for (catalog, search, public lists, prompts), says which of those permissions are missing, and shows the username only if the key allows it.

## 0.19.0 (2026-10-29)

- **Sign in with Hardcover.** People can connect their Hardcover account with a Connect with Hardcover button in My account (and on Discover) instead of making and pasting a key. Shelfhelp asks for read:me:content, read:library, write:library, read:vibes, read:catalog, read:lists and offline_access, keeps the tokens on the server, and renews them as they expire. Pasting a key still works, and either one replaces the other. Disconnect signs out on Hardcover too.
- To turn it on, make a web app under Developer apps on hardcover.app with the redirect link shown in Settings, Hardcover, then enter its client ID and secret there (or `HARDCOVER_CLIENT_ID` and `HARDCOVER_CLIENT_SECRET`).
- **The Hardcover key in Settings is now the server's own key**, used only for shared data: trending, genres and moods, book details, editions and public lists. It no longer stands in for the owner's account. On upgrade the owner keeps that key as their personal connection until they sign in with Hardcover or paste another, so nothing changes until you replace the server key (ideally with a key from a Hardcover account made just for Shelfhelp).
- Shelf collections (Want to Read, Read and so on) are always read with their owner's own connection, and picking shelves or lists under Collections uses yours. Private lists you add are read with your connection.

## 0.18.0 (2026-10-29)

- Book popups show the book's genres and moods from Hardcover (up to six of each) when you tap More under the description. Each one opens that genre or mood's page. Nothing is added to the short view. Books without a description show a small "Genres and moods" link instead.
- Following a link out of a book popup closes the popup, and Back from the new page returns to where you were without an extra press.

## 0.17.0 (2026-10-29)

- Hardcover keys are checked for the permissions Shelfhelp needs (read:me:content, read:library, write:library, read:vibes, read:catalog) when someone connects. A key missing any of them is refused with a message saying which, instead of connecting and then quietly failing.
- My account lists the permissions to give a new key, and warns when the saved key is missing some or Hardcover no longer accepts it. Discover shows the same warning above the rows.
- Top picks for you, From your Want to Read and Pick up where you left off stay on Discover when they're empty, with a line saying why, instead of disappearing. Empty answers are no longer remembered, so these rows fill in as soon as there's something to show.

## 0.16.1 (2026-10-29)

- The phone's Back button now closes a book's popup (and any other popup, like Customize or an issue) instead of leaving the page. With a popup open on top of another, Back closes the top one first. Back also closes the phone's side menu.

## 0.16.0 (2026-10-29)

- Customize this page: "Add a row" is now one search for genres, moods and your Hardcover lists, plus the built-in rows. Each result is labeled Genre, Mood, List or Row. Paste a link to any public Hardcover list into the same box to add it. The separate genre row, mood row and Hardcover list sections are gone; the built-in row buttons stay under the search.

## 0.15.0 (2026-10-29)

- Browse by genre and Browse by mood now start with Hardcover's top 20 of each by number of books ("General" is skipped as a catch-all, so Philosophy is the 20th genre).
- New All genres and All moods pages: every genre or mood on Hardcover with at least a few books, most books first, with a filter box. Open them from the "All genres" and "All moods" links and chips on Discover. Each genre or mood opens its own page of top books (This month, This year, All time), including ones that aren't in the defaults.
- Customize this page:
  - "Add a genre row" and "Add a mood row" say clearly that they add rows to Discover, and a search box adds a row for any genre or mood on Hardcover.
  - New "Genres and moods to browse" section: remove chips from Browse by genre and Browse by mood, or search Hardcover to add more. Admins can save these as everyone's default along with the rows, and "Use the defaults" resets them.

## 0.14.0 (2026-10-28)

- Discover is personal for every reader: Top picks for you, From your Want to Read and Pick up where you left off use each person's own Hardcover account, and New from authors you listen to uses their own listening when Shelfhelp has it. People who haven't connected Hardcover don't see those rows, and Discover shows a line asking them to connect it in My account.
- Each reader's Hardcover shelves are read for Discover even with reading sync off (every few hours, and right after they connect Hardcover).
- Connecting Hardcover no longer turns on reading sync. New readers start with it off, and My account has a Reading sync switch to turn it on.
- Want to Read: books on Discover (and in search) have a Want to Read button on hover, and the book popup has one too. It adds the book to your own Hardcover Want to Read shelf. Books already on one of your shelves show that shelf instead.
- The book popup shows the book's Hardcover description, small and cut off after three lines, with More to read the rest.
- Genre and mood pages open on This month (then This year and All time). Genre and mood rows on Discover show this month too, falling back to all time when too few books are trending.
- Customize this page: drag rows by the handle to reorder them (works with touch too) instead of the up and down buttons.
- Fixed: readers who aren't admins couldn't load editions in "Advanced: pick a specific edition".

## 0.13.0 (2026-10-28)

- Genre and mood pages have an All time / This year / This month switch. All time is the most-read books with that genre or mood. This year and This month are Hardcover's trending books for that period that have the genre or mood.
- The genre and mood lines on Discover are now sections like the other rows: "Browse by genre" and "Browse by mood", each with a subtitle and scroll arrows.

## 0.12.0 (2026-10-28)

- Each reader gets a Want to Read collection automatically: as soon as someone connects Hardcover (in My account, Settings, Users, or the owner's token in Settings), Shelfhelp makes "Name's Want to Read" from their own Hardcover shelf in the first Audiobookshelf library and syncs it. Readers who already have a Hardcover token get theirs on the next sync. Each is made once, so one you delete stays deleted. Turn it off in Settings, General.
- Shelf collections can now follow another reader's Hardcover shelf, using their token.
- Discover: the genre and mood lines moved to the bottom, just above Customize this page, with Recently added right above them.

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

- Requested books are tagged in Audiobookshelf with who asked for them ("Requested by alex"), like Seerr tags requests in Sonarr and Radarr. Existing tags are kept, and the wording can be changed under Settings, Chaptarr.
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
