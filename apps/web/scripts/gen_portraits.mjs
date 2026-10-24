// Regenerates public/assets/portraits/<name>.svg with DiceBear "Lorelei", matched to each colleague's gender
// (the same gender the voices use: gender_of() in apps/api/app/simulation/tracks.py).
// Run from apps/api (DiceBear is installed to a throwaway folder, not into the app):
//   npm i --prefix /tmp/dicebear @dicebear/core@9.2.2 @dicebear/collection@9.2.2
//   uv run python -c "import json,os;from app.simulation.tracks import gender_of;print(json.dumps({f[:-4]:gender_of(f.split('-')[0].title()) for f in os.listdir('../web/public/assets/portraits') if f.endswith('.svg')}))" \
//     | npm_config_prefix=/tmp/dicebear node ../web/scripts/gen_portraits.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(`${process.env.npm_config_prefix ?? process.cwd()}/`);
const { createAvatar } = require("@dicebear/core");
const { lorelei } = require("@dicebear/collection");

const v = (ns) => ns.map((n) => `variant${String(n).padStart(2, "0")}`);
// Lorelei hairstyles sorted by eye (11 and 34 are ambiguous and unused).
const HAIR = {
  male: v([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 20, 22, 25, 27, 28, 36, 39, 43, 44, 47]),
  female: v([10, 13, 14, 15, 16, 17, 18, 19, 21, 23, 24, 26, 29, 30, 31, 32, 33, 35, 37, 38, 40, 41, 42, 45, 46, 48]),
};
const out = new URL("../public/assets/portraits/", import.meta.url);
const people = JSON.parse(readFileSync(0, "utf8"));
for (const [slug, gender] of Object.entries(people)) {
  const male = gender === "male";
  const svg = createAvatar(lorelei, {
    seed: slug,
    hair: HAIR[male ? "male" : "female"],
    beardProbability: male ? 30 : 0,
    earringsProbability: male ? 0 : 40,
    backgroundColor: ["ffffff"],
  }).toString();
  writeFileSync(new URL(`${slug}.svg`, out), svg);
}
console.log(`wrote ${Object.keys(people).length} portraits`);
