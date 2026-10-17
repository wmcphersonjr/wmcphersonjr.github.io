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
- **Meal plan.** A Monday–Sunday week view. Add dishes from a day or from any recipe's **Plan** button. Each day suggests sides that pair well, such as buss up shut with a curry or garlic rice with oxtail. One button adds the whole week to groceries.
- **Smarter groceries.** By default the list is sorted by aisle, with duplicates combined across recipes (for example, 4 cloves + 3 heads garlic). Pantry staples such as salt, oil and flour are tucked into their own section, and you can edit that list. You can switch back to grouping by recipe.
- **Ratings, notes and your photos.** Rate dishes 1–5 stars, and sort the library by top rated. Photos you add are resized and kept on the device in IndexedDB; any of them can be the recipe's cover.
- **What can I make?** List what you have on hand. Recipes are ranked by how few ingredients you'd need to buy, and the missing ones go to the grocery list in one tap.
- **Units.** Switch between *As written*, *US* and *Metric* on any recipe or in cooking mode. Ingredient amounts and oven temperatures convert; dry ingredients convert to grams using typical densities.
- **Cook together.** Run several recipes in one cooking mode, with a tab per dish. The longest dish is started first, and timers are labeled by dish. Start it from a collection, a day in the plan, or a recipe's ⋯ menu.
- **Collections.** Group recipes for an occasion, with a day-of timeline. Four starters are included: Día de Muertos, Competition Prep, Date Night and Thanksgiving.
- **The Chef's Notebook.** 65 techniques, including knife skills, bread and cocktails. You can add your own techniques; they show up on matching recipes.
- **Ask Claude.** Ask about substitutions, scaling or fixes on any recipe, and save the answer to your notes. **Snap a photo** in Add a recipe turns a cookbook page or recipe card into a draft. Inside the Claude app this needs no setup. On the site, add an Anthropic API key in Settings; it is stored only on the device and sent only to Anthropic.
- **Nutrition (estimate).** Calories, protein, carbs and fat per serving, worked out from a built-in ingredient table. It shows which ingredients it couldn't count.
- **Share.** A recipe can be shared as a card image (PNG), clean text, or a standalone `.html` page with schema.org data. The `.html` page can be imported back without losing anything.
- **Sync across devices (optional).** Paste a fine-grained GitHub token (Contents: read & write on this repo) in Settings. The app then merges and saves `recipes/data/recipes.json`, and the newest edit wins per recipe. Without a token, everything is stored in the browser, and you can export JSON or Markdown backups.

## Files

| Path | Purpose |
| --- | --- |
| `book.md` | The original recipe book (source text) |
| `data/recipes.json` | The book as data. The app loads it, and GitHub sync writes to it. |
| `js/parse.js` | Parsers (Markdown/chat, schema.org, voice), scaling, timers, Markdown export |
| `js/kitchen.js` | Ingredient parsing, unit conversion, grocery merging and aisles, pairings, nutrition, "what can I make" |
| `js/tips.js` | The Chef's Notebook content |
| `js/app.js` | The app |
| `tools/build-seed.js` | Merges `book.md` into `data/recipes.json` |

## Editing the book by hand

Edit `book.md` (one `## Recipe` per recipe, under `# CATEGORY` headings), then run:

```sh
node recipes/tools/build-seed.js
```

New and changed recipes get a fresh timestamp, so every device picks them up on its next visit. Recipes that were added in the app and synced are kept.
