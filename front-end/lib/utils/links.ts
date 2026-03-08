// Generate Solscan token URL
export function getSolscanTokenUrl(mint: string | undefined): string {
  if (!mint) return "#";
  return `https://solscan.io/token/${mint}`;
}

// Generate Solscan transaction URL
export function getSolscanTxUrl(txId: string | undefined): string {
  if (!txId) return "#";
  return `https://solscan.io/tx/${txId}`;
}

// Generate DexScreener URL
export function getDexScreenerUrl(mint: string | undefined): string {
  if (!mint) return "#";
  return `https://dexscreener.com/solana/${mint}`;
}

// Generate Birdeye URL
export function getBirdeyeUrl(mint: string | undefined): string {
  if (!mint) return "#";
  return `https://birdeye.so/token/${mint}?chain=solana`;
}

// Open link in new tab
export function openExternalLink(url: string): void {
  if (url && url !== "#") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
