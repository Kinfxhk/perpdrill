import { parsePracticePreset, type PracticePreset } from "@perpdrill/core";

const FILE_NAME = /^[a-z0-9-]+\.json$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadCommunityPresets(): Promise<readonly PracticePreset[]> {
  const indexUrl = new URL("presets/index.json", document.baseURI);
  const indexResponse = await fetch(indexUrl);
  if (!indexResponse.ok) {
    throw new Error("preset index failed");
  }
  const indexBody: unknown = await indexResponse.json();
  if (!isRecord(indexBody) || !Array.isArray(indexBody.files)) {
    throw new Error("preset index is invalid");
  }
  const presets: PracticePreset[] = [];
  for (const file of indexBody.files) {
    if (typeof file !== "string" || !FILE_NAME.test(file)) {
      throw new Error("preset file name is invalid");
    }
    const response = await fetch(new URL(`presets/${file}`, document.baseURI));
    if (!response.ok) {
      throw new Error("preset file failed");
    }
    const parsed = parsePracticePreset(await response.json());
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    presets.push(parsed.preset);
  }
  return presets;
}
