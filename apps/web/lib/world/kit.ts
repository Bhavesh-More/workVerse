// The world kit for the app: catalog, tile and atlas metadata (bundled JSON) plus lazily loaded
// images. Pure world code takes a Kit argument so it also runs under node --test.
import catalog from "../../public/assets/game/kit/catalog.json";
import tiles from "../../public/assets/game/kit/tiles.json";
import atlas from "../../public/assets/game/kit/props.json";
import { makeKit, type Atlas, type Catalog, type TilesMeta } from "./types.ts";

export const KIT = makeKit(catalog as unknown as Catalog, tiles as unknown as TilesMeta, atlas as unknown as Atlas);

export const KIT_PATHS = {
  tiles: "/assets/game/kit/tiles.png",
  props: "/assets/game/kit/props.png",
  char: (key: string) => `/assets/game/chars/${key}.png`,
};

export type KitImages = { tiles: HTMLImageElement; props: HTMLImageElement; chars: Record<string, HTMLImageElement> };

const CHAR_KEYS = ["player", "m1", "m2", "m3", "m4", "m5", "f1", "f2", "f3", "f4", "f5", "cat_white", "cat_brown", "cat_brown2"];
let loading: Promise<KitImages> | null = null;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Loads once per tab; later callers share the same promise. */
export function loadKitImages(): Promise<KitImages> {
  loading ??= Promise.all([load(KIT_PATHS.tiles), load(KIT_PATHS.props), ...CHAR_KEYS.map((k) => load(KIT_PATHS.char(k)))]).then(
    ([t, p, ...cs]) => ({ tiles: t!, props: p!, chars: Object.fromEntries(CHAR_KEYS.map((k, i) => [k, cs[i]!])) }),
  );
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export { JUDGE_LOOK, JUDGE_TITLES } from "./validate.ts";
