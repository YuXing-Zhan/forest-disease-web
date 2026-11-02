import type { Settings } from "./api";

// These values are intentionally public in the deployed browser bundle.
// GitHub Secrets protects the repository source, not the published website.
const kindwise = import.meta.env.VITE_SHARED_KINDWISE_KEY || "";
const deepseek = import.meta.env.VITE_SHARED_DEEPSEEK_KEY || "";
export const sharedAvailable = Boolean(kindwise || deepseek);
export function sharedActive(settings: Settings) {
  return sharedAvailable && (settings.sharedExpires || 0) > Date.now();
}
export function effectiveDirectSettings(settings: Settings): Settings {
  const active = sharedActive(settings);
  return {
    ...settings,
    kindwise: settings.kindwise.trim() || (active ? kindwise : ""),
    deepseek: settings.deepseek.trim() || (active ? deepseek : ""),
  };
}
export async function checkSharedAnswer(answer: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(answer.trim()),
  );
  const hash = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return [
    "156cc7139acdd7a8b0145620e0840f323a35c05ddb35bca1c1991106d408bcd8",
    "2744ad59dfec5f7db9ea35015662d9e041325dac5d2ef78b24d6e83427bfba43",
  ].includes(hash);
}
