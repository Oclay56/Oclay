const USD_MICRO_SCALE = 1_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000n;

export function usdToMicro(usd: number): bigint {
  if (!Number.isFinite(usd)) return 0n;
  const sign = usd < 0 ? -1n : 1n;
  const normalized = Math.abs(usd).toFixed(6);
  const [wholeRaw = "0", fracRaw = ""] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+/, "") || "0";
  const frac = `${fracRaw}000000`.slice(0, 6);
  const micros = BigInt(whole) * USD_MICRO_SCALE + BigInt(frac);
  return sign * micros;
}

export function microToUsdNumber(micro: bigint): number {
  const text = microToUsdString(micro);
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function microToUsdString(micro: bigint): string {
  const sign = micro < 0n ? "-" : "";
  const abs = micro < 0n ? -micro : micro;
  const whole = abs / USD_MICRO_SCALE;
  const frac = abs % USD_MICRO_SCALE;
  return `${sign}${whole.toString()}.${frac.toString().padStart(6, "0")}`;
}

export function lamportsToMicroUsd(lamports: bigint, baseAssetUsdPrice: number): bigint {
  const priceMicro = usdToMicro(baseAssetUsdPrice);
  return (lamports * priceMicro) / LAMPORTS_PER_SOL;
}

export function lamportsToUsdNumber(lamports: bigint, baseAssetUsdPrice: number): number {
  return microToUsdNumber(lamportsToMicroUsd(lamports, baseAssetUsdPrice));
}
