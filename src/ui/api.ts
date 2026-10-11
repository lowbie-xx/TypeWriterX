import type { Machine } from "../core/machine";
import type { Prefs } from "../core/prefs";
import type { Renderer } from "../render/renderer";
import type { Commands } from "./commands";

/** What the UI pieces need from the app controller. */
export interface AppApi {
  machine: Machine;
  renderer: Renderer;
  commands: Commands;
  readonly prefs: Prefs;
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  readonly docName: string;
  readonly dirty: boolean;
  /** Call after editing document settings; `font` reloads the typeface. */
  docSettingsChanged(opts?: { font?: boolean }): void;
  toast(message: string): void;
}
