import { mountDesk } from "./desk.ts";
import { applyDocumentTheme, readStoredTheme } from "./i18n.ts";

applyDocumentTheme(readStoredTheme());

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("missing #app");
}

mountDesk(root);
