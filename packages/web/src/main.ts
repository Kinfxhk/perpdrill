import { mountDesk } from "./desk.ts";
import { readStoredTheme } from "./i18n.ts";

const theme = readStoredTheme();
// The default palette is unthemed CSS; only venue themes set the attribute.
if (theme !== "teal") {
  document.documentElement.dataset.theme = theme;
}

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("missing #app");
}

mountDesk(root);
