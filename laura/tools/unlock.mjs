// Restores the readable source from the encrypted files (e.g. in a fresh checkout).
//
//   node laura/tools/unlock.mjs <passcode>
//
// Writes laura/private/stories.js and laura/private/photos/<person-id>/NN.jpg + NN.t.jpg.
// Edit stories.js, then run lock.mjs with the same passcode to rebuild.
// Note: stories.js is regenerated from data, so comments from the original are not kept.

import fs from "node:fs";
import path from "node:path";
import { webcrypto as crypto } from "node:crypto";
import { deriveKey } from "./lock.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PRIVATE = path.join(ROOT, "private");
const DATA = path.join(ROOT, "data");

async function decrypt(key, buf) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12)));
}

const passcode = process.argv[2];
if (!passcode) { console.error("usage: node unlock.mjs <passcode>"); process.exit(1); }
const salt = new Uint8Array(Buffer.from(fs.readFileSync(path.join(DATA, "salt"), "utf8").trim(), "base64"));
const key = await deriveKey(passcode, salt);

let book;
try {
  book = JSON.parse(new TextDecoder().decode(await decrypt(key, fs.readFileSync(path.join(DATA, "content.bin")))));
} catch {
  console.error("Wrong passcode."); process.exit(1);
}

fs.mkdirSync(PRIVATE, { recursive: true });
let n = 0;
for (const p of book.PEOPLE) {
  const dir = path.join(PRIVATE, "photos", p.id);
  (p.photos || []).forEach((ph, i) => fs.mkdirSync(dir, { recursive: true }));
  for (const [i, ph] of (p.photos || []).entries()) {
    const base = String(i + 1).padStart(2, "0");
    fs.writeFileSync(path.join(dir, base + ".jpg"), await decrypt(key, fs.readFileSync(path.join(DATA, "p", ph.f + ".bin"))));
    fs.writeFileSync(path.join(dir, base + ".t.jpg"), await decrypt(key, fs.readFileSync(path.join(DATA, "p", ph.t + ".bin"))));
    n++;
  }
  p.photos = (p.photos || []).length;
}

const js = Object.entries(book).map(([k, v]) => `window.${k} = ${JSON.stringify(v, null, 2)};`).join("\n\n");
fs.writeFileSync(path.join(PRIVATE, "stories.js"), "// Restored by unlock.mjs\n" + js + "\n");
console.log(`Restored ${book.PEOPLE.length} letters and ${n} photos to laura/private/.`);
