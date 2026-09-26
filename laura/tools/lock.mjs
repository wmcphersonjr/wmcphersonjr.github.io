// Encrypts the book so the public repo only holds ciphertext.
//
//   node laura/tools/lock.mjs <passcode>
//
// Reads   laura/private/stories.js            (readable content, never committed)
//         laura/private/photos/<person-id>/NN.jpg + NN.t.jpg (full + thumbnail)
// Writes  laura/data/content.bin              (all content + photo list, AES-GCM)
//         laura/data/p/<name>.bin             (each photo, AES-GCM)
//         laura/data/salt                     (random, public; reused so file names stay stable)
//
// The key is PBKDF2-SHA256(passcode, salt). The browser derives the same key from the
// passcode typed at the gate (see app.js). Restore the private folder with unlock.mjs.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto as crypto } from "node:crypto";

export const ITERATIONS = 310000;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PRIVATE = path.join(ROOT, "private");
const DATA = path.join(ROOT, "data");

export async function deriveKey(passcode, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

async function fileName(salt, id) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Buffer.from(salt).toString("hex") + id));
  return Buffer.from(h).toString("hex").slice(0, 24);
}

async function main() {
  const passcode = process.argv[2];
  if (!passcode) { console.error("usage: node lock.mjs <passcode>"); process.exit(1); }

  const saltPath = path.join(DATA, "salt");
  fs.mkdirSync(path.join(DATA, "p"), { recursive: true });
  if (!fs.existsSync(saltPath)) fs.writeFileSync(saltPath, Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64"));
  const salt = new Uint8Array(Buffer.from(fs.readFileSync(saltPath, "utf8").trim(), "base64"));
  const key = await deriveKey(passcode, salt);

  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(PRIVATE, "stories.js"), "utf8"), sandbox);
  const book = sandbox.window;

  const written = new Set();
  let photoCount = 0;
  for (const p of book.PEOPLE) {
    const dir = path.join(PRIVATE, "photos", p.id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^\d+\.jpg$/.test(f)).sort() : [];
    p.photos = [];
    for (const f of files) {
      const entry = {};
      for (const [k, src] of [["f", f], ["t", f.replace(".jpg", ".t.jpg")]]) {
        const name = await fileName(salt, `${p.id}/${src}`);
        const dest = path.join(DATA, "p", name + ".bin");
        fs.writeFileSync(dest, await encrypt(key, fs.readFileSync(path.join(dir, src))));
        written.add(name + ".bin");
        entry[k] = name;
      }
      p.photos.push(entry);
      photoCount++;
    }
  }
  for (const f of fs.readdirSync(path.join(DATA, "p"))) if (!written.has(f)) fs.unlinkSync(path.join(DATA, "p", f));

  const json = JSON.stringify({
    BOOK: book.BOOK, GROUPS: book.GROUPS, SECTIONS: book.SECTIONS, TAGS: book.TAGS,
    MOODS: book.MOODS, PEOPLE: book.PEOPLE, FACTS: book.FACTS,
  });
  fs.writeFileSync(path.join(DATA, "content.bin"), await encrypt(key, new TextEncoder().encode(json)));
  console.log(`Locked ${book.PEOPLE.length} letters and ${photoCount} photos.`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
