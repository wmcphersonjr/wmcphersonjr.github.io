# Waynesdays Recipe Book

A static web app for the recipe book, published at **https://wmcphersonjr.github.io/recipes/**. It has no build step and no server. You can install it on a phone's home screen, and it works offline.

## What it does

- **Browse and organize.** Recipes are grouped by category. You can filter by tag, favorites or "30 min or less", and sort by book order, A–Z, newest, most cooked or quickest.
- **Search.** Search covers titles, tags, ingredients, steps and notes. It tolerates typos (`bulgogy` finds Bulgogi), excludes words with a minus (`curry -green`), and can be done by voice using the mic in the search bar.
- **Recipe page.**
  - Ingredient checklist, and scaling from ¼× to 10× (quantities rewrite themselves).
  - Tappable timers inside each step, and steps you can tick off.
  - "My notes", a cook log, sources, share/copy/print, and adding ingredients to the grocery list.
- **Cooking mode.** This shows one big step at a time, starting with a mise en place checklist.
  - Each step lists the ingredients it uses and has one-tap timers. Several timers can run at once, with an alarm, vibration and a notification.
  - The screen stays awake. You can move between steps by swipe or keyboard, and text size is adjustable.
  - It can read steps aloud. Hands-free voice control understands "next", "back", "repeat", "ingredients", "start timer", "step 3" and "stop".
- **Adding recipes.** Every method ends on a review screen before anything is saved.
  - **Say it:** dictate the whole recipe ("Title … Ingredients … next … Steps …").
  - **From a website:** paste a link. The app reads the schema.org recipe data, and falls back to pasted page text if the site blocks it. There is also a drag-to-bookmarks "Save to Recipe Book" button, and Android's Share menu once the app is installed.
  - **From a chat:** paste text from Claude, a message, notes or an email. A whole book is split into separate recipes. There is also a "Copy prompt for Claude" button that returns recipes in the ideal format.
  - **Type it:** every field has its own dictation mic.
  - **Import a file:** `.md`, `.txt` or a `.json` backup.
- **Groceries.** Each recipe's ingredients are grouped and scaled. You can add your own items (by voice too), then share or copy the list.
- **Sync across devices (optional).** Paste a fine-grained GitHub token (Contents: read & write on this repo) in Settings. The app then merges and saves `recipes/data/recipes.json`, and the newest edit wins per recipe. Without a token, everything is stored in the browser, and you can export JSON or Markdown backups.

## Files

| Path | Purpose |
| --- | --- |
| `book.md` | The original recipe book (source text) |
| `data/recipes.json` | The book as data. The app loads it, and GitHub sync writes to it. |
| `js/parse.js` | Parsers (Markdown/chat, schema.org, voice), scaling, timers, Markdown export |
| `js/app.js` | The app |
| `tools/build-seed.js` | Merges `book.md` into `data/recipes.json` |

## Editing the book by hand

Edit `book.md` (one `## Recipe` per recipe, under `# CATEGORY` headings), then run:

```sh
node recipes/tools/build-seed.js
```

New and changed recipes get a fresh timestamp, so every device picks them up on its next visit. Recipes that were added in the app and synced are kept.
