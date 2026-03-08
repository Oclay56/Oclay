export interface RuntimeDashboardStreamState {
  enabled: boolean;
  connected: boolean;
  stale: boolean;
  fallbackActive: boolean;
  lastEventAtMs?: number;
}

export interface RuntimeDashboardSell429MintState {
  mint: string;
  streak: number;
  cooldownUntilMs: number;
}

export interface RuntimeDashboardSell429State {
  globalCooldownUntilMs?: number;
  perMint: RuntimeDashboardSell429MintState[];
}

export interface RuntimeDashboardCapitalState {
  pendingReservedEntryUsd: number;
  baseAssetUsdPrice?: number;
  baseAssetUsdPriceAtMs?: number;
  walletSolBalance?: number;
  walletUsdBalance?: number;
  walletBalanceAtMs?: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  deployedUsd: number;
  dailyDrawdownUsd: number;
}

export interface RuntimeDashboardState {
  stream?: RuntimeDashboardStreamState;
  sell429?: RuntimeDashboardSell429State;
  capital?: RuntimeDashboardCapitalState;
}

export interface RuntimeDashboardStatePatch {
  stream?: Partial<RuntimeDashboardStreamState>;
  sell429?: Partial<RuntimeDashboardSell429State>;
  capital?: Partial<RuntimeDashboardCapitalState>;
}
