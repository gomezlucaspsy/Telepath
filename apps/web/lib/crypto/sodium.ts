import _sodium from "libsodium-wrappers-sumo";

let readyPromise: Promise<typeof _sodium> | null = null;

export function getSodium(): Promise<typeof _sodium> {
  if (!readyPromise) {
    readyPromise = _sodium.ready.then(() => _sodium);
  }
  return readyPromise;
}
