export function getBucket() {
  const binding = (globalThis as typeof globalThis & { __FOODTAB_BUCKET__?: R2Bucket }).__FOODTAB_BUCKET__;
  if (!binding) {
    throw new Error("Úložiště PDF není dostupné. Zkontrolujte vazbu BUCKET v nastavení aplikace.");
  }
  return binding;
}
