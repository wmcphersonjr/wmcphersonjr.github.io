#!/usr/bin/env node
/*
 * Merges book.md into data/recipes.json (the file the app loads and syncs).
 *   node recipes/tools/build-seed.js
 * - New recipes in book.md are added; edited ones get a fresh updatedAt so every device picks them up.
 * - Recipes that only exist in the JSON (added in the app and synced to GitHub) are kept untouched.
 */
const fs = require('fs');
const path = require('path');
const RB = require('../js/parse.js');

const root = path.join(__dirname, '..');
const file = path.join(root, 'data', 'recipes.json');
const book = RB.parseBook(fs.readFileSync(path.join(root, 'book.md'), 'utf8'));
let prev = { recipes: [], deleted: {}, meta: {} };
try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first run */ }

const now = new Date().toISOString();
const strip = (r) => { const { id, createdAt, updatedAt, ...rest } = r; return JSON.stringify(rest); };
const byId = new Map((prev.recipes || []).map((r) => [r.id, r]));
const out = [];
const seen = new Set();
let changed = 0;
book.recipes.forEach((r) => {
  let id = RB.slugify(r.title.replace(/\(.*?\)/g, ''));
  while (seen.has(id)) id += '-2';
  seen.add(id);
  const old = byId.get(id);
  if (old && strip(old) === strip(r)) { out.push(old); return; }
  changed++;
  out.push(Object.assign({}, r, { id, createdAt: (old && old.createdAt) || now, updatedAt: now }));
});
(prev.recipes || []).forEach((r) => { if (!seen.has(r.id)) out.push(r); });
const data = { format: 'waynesdays-recipes', version: 1, title: book.title || prev.title, updatedAt: changed ? now : (prev.updatedAt || now),
  recipes: out, deleted: prev.deleted || {}, meta: prev.meta || {} };
fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
console.log(`${out.length} recipes (${changed} added/updated from book.md)`);
