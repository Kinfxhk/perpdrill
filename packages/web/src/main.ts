import { mountDesk } from "./desk.ts";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("missing #app");
}

mountDesk(root);
