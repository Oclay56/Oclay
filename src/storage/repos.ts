import type { SqliteDb } from "./sqlite";
import type { DexPairSnapshot, Position, TokenRiskReport } from "../domain/types";

export interface Repos {
  upsertToken: (params: { mint: string; seenAtMs: number; source: string }) => void;
  insertSnapshot: (params: { mint: string; capturedAtMs: number; pair: DexPairSnapshot | null }) => void;
  insertRiskReport: (report: TokenRiskReport) => void;
  getLatestRiskReport: (mint: string) => { createdAtMs: number; metrics: any; flags: string[] } | null;
  getLatestSnapshot: (
    mint: string
  ) => {
    capturedAtMs: number;
    liquidityUsd: number | null;
    priceUsd: number | null;
    volumeM5Usd: number | null;
    volumeH1Usd: number | null;
    volumeH24Usd: number | null;
  } | null;
  getRecentSnapshotsByMint: (params: {
    mint: string;
    sinceMs: number;
    limit?: number;
  }) => Array<{
    capturedAtMs: number;
    priceUsd: number | null;
    liquidityUsd: number | null;
    volumeM5Usd: number | null;
    volumeH1Usd: number | null;
    volumeH24Usd: number | null;
    buysM5: number | null;
    sellsM5: number | null;
  }>;

  setBlock: (params: { mint: string; reason: string; expiresAtMs: number }) => void;
  isBlocked: (mint: string, nowMs: number) => boolean;
  getBlock: (mint: string, nowMs: number) => { mint: string; reason: string; expiresAtMs: number } | null;
  deleteExpiredBlocks: (nowMs: number) => number;

  createPosition: (p: Position) => void;
  updatePosition: (p: Partial<Position> & { id: string }) => void;
  getOpenPositions: () => Position[];
  getOpenPositionByMint: (mint: string) => Position | null;
  getPositionById: (id: string) => Position | null;
  countOpenPositions: () => number;
  realizedPnlUsdSince: (sinceMs: number) => number;
  normalizeTransientPositionStates: () => number;
  getConsecutiveLossStats: (params: { sinceMs: number; mode?: "paper" | "live"; cooldownMinutes: number }) => {
    consecutiveLosses: number;
    blockedUntilMs?: number;
  };

  insertExecution: (params: {
    id: string;
    intentId: string;
    positionId?: string;
    mint: string;
    side: "BUY" | "SELL";
    mode: "paper" | "live";
    requestedAtMs: number;
    executedAtMs?: number;
    ok: boolean;
    txSig?: string;
    err?: string;
    inAmount?: bigint;
    outAmount?: bigint;
    slippageBps?: number;
    raw?: unknown;
  }) => void;
  insertExecutionAttempt: (params: {
    id: string;
    intentId: string;
    positionId?: string;
    mint: string;
    router: "raydium_direct" | "jupiter";
    attemptNo: number;
    stage: "BUILD" | "SIMULATE" | "SEND" | "CONFIRM" | "RECONCILE";
    ok: boolean;
    txSig?: string;
    err?: string;
    inAmount?: bigint;
    outAmount?: bigint;
    requestedAtMs: number;
    executedAtMs?: number;
    raw?: unknown;
  }) => void;
  patchLatestExecutionRawByIntent: (params: {
    intentId: string;
    patch: Record<string, unknown>;
  }) => boolean;
  insertPositionLeg: (params: {
    id: string;
    positionId: string;
    mint: string;
    side: "BUY" | "SELL";
    intentKind: string;
    requestedAtMs: number;
    executedAtMs?: number;
    inAmount?: bigint;
    outAmount?: bigint;
    ok: boolean;
    txSig?: string;
    err?: string;
    raw?: unknown;
  }) => void;
  insertLifecycleEvent: (params: {
    id: string;
    runId?: string;
    candidateId?: string;
    mint: string;
    positionId?: string;
    intentId?: string;
    stage: string;
    atMs: number;
    meta?: unknown;
  }) => void;
  insertTradeAttribution: (params: {
    id: string;
    positionId: string;
    mint: string;
    mode: "paper" | "live";
    openedAtMs: number;
    closedAtMs: number;
    holdMs: number;
    pnlUsd?: number;
    features: unknown;
  }) => void;
  getLatencyStats: (
    windowMinutes: number,
    mode?: "candidate_intent_position"
  ) => {
    mode: "candidate_intent_position";
    sampleSize: number;
    detectToIntentSamples: number;
    sentToConfirmedSamples: number;
    detectToIntentMs: { p50: number | null; p95: number | null };
    sentToConfirmedMs: { p50: number | null; p95: number | null };
  };
  getAttributionLeaderboard: (limit: number) => Array<{
    key: string;
    trades: number;
    winRate: number;
    avgPnlUsd: number;
    totalPnlUsd: number;
  }>;
}

export function createRepos(db: SqliteDb): Repos {
  const upsertTokenStmt = db.prepare(`
    INSERT INTO tokens (mint, first_seen_at, last_seen_at, source)
    VALUES (@mint, @seenAt, @seenAt, @source)
    ON CONFLICT(mint) DO UPDATE SET last_seen_at=excluded.last_seen_at;
  `);

  const insertSnapshotStmt = db.prepare(`
    INSERT INTO token_snapshots (
      mint, captured_at, pair_address, dex_id, url,
      price_usd, price_native, liquidity_usd,
      volume_m5, volume_h1, volume_h6, volume_h24,
      buys_m5, sells_m5, buys_h1, sells_h1, buys_h6, sells_h6, buys_h24, sells_h24,
      price_change_m5, price_change_h1, price_change_h6, price_change_h24,
      pair_created_at
    ) VALUES (
      @mint, @capturedAt, @pairAddress, @dexId, @url,
      @priceUsd, @priceNative, @liquidityUsd,
      @volumeM5, @volumeH1, @volumeH6, @volumeH24,
      @buysM5, @sellsM5, @buysH1, @sellsH1, @buysH6, @sellsH6, @buysH24, @sellsH24,
      @priceChangeM5, @priceChangeH1, @priceChangeH6, @priceChangeH24,
      @pairCreatedAt
    );
  `);

  const insertRiskReportStmt = db.prepare(`
    INSERT INTO risk_reports (
      mint, created_at, flags_json, risk_score, opportunity_score, trade_score, metrics_json, reasons_json
    ) VALUES (
      @mint, @createdAt, @flagsJson, @riskScore, @opportunityScore, @tradeScore, @metricsJson, @reasonsJson
    );
  `);
  const latestRiskReportStmt = db.prepare(`
    SELECT created_at, flags_json, metrics_json
    FROM risk_reports
    WHERE mint=?
    ORDER BY created_at DESC
    LIMIT 1;
  `);

  const latestSnapshotStmt = db.prepare(`
    SELECT captured_at, liquidity_usd, price_usd, volume_m5, volume_h1, volume_h24
    FROM token_snapshots
    WHERE mint=?
    ORDER BY captured_at DESC
    LIMIT 1;
  `);
  const recentSnapshotsByMintStmt = db.prepare(`
    SELECT captured_at, price_usd, liquidity_usd, volume_m5, volume_h1, volume_h24, buys_m5, sells_m5
    FROM token_snapshots
    WHERE mint=? AND captured_at >= ?
    ORDER BY captured_at DESC
    LIMIT ?;
  `);

  const setBlockStmt = db.prepare(`
    INSERT INTO blocks (mint, reason, blocked_at, expires_at)
    VALUES (@mint, @reason, @blockedAt, @expiresAt)
    ON CONFLICT(mint) DO UPDATE SET reason=excluded.reason, blocked_at=excluded.blocked_at, expires_at=excluded.expires_at;
  `);
  const getBlockStmt = db.prepare(`SELECT mint, expires_at FROM blocks WHERE mint=?;`);
  const getBlockFullStmt = db.prepare(`SELECT mint, reason, expires_at FROM blocks WHERE mint=?;`);
  const deleteExpiredBlocksStmt = db.prepare(`DELETE FROM blocks WHERE expires_at <= ?;`);

  const createPositionStmt = db.prepare(`
    INSERT INTO positions (
      id, mint, mode, status, opened_at, closed_at,
      base_mint, entry_base_amount, entry_token_amount,
      exit_base_amount, entry_tx, exit_tx,
      entry_price_usd, exit_price_usd, pnl_usd, max_seen_price_usd,
      initial_token_amount, current_token_amount, sniper_mode, tp_step, stage
    ) VALUES (
      @id, @mint, @mode, @status, @openedAt, @closedAt,
      @baseMint, @entryBaseAmount, @entryTokenAmount,
      @exitBaseAmount, @entryTx, @exitTx,
      @entryPriceUsd, @exitPriceUsd, @pnlUsd, @maxSeenPriceUsd,
      @initialTokenAmount, @currentTokenAmount, @sniperMode, @tpStep, @stage
    );
  `);

  const updatePositionStmt = db.prepare(`
    UPDATE positions SET
      status = COALESCE(@status, status),
      closed_at = COALESCE(@closedAtMs, closed_at),
      entry_base_amount = COALESCE(@entryBaseAmount, entry_base_amount),
      entry_token_amount = COALESCE(@entryTokenAmount, entry_token_amount),
      exit_base_amount = COALESCE(@exitBaseAmount, exit_base_amount),
      entry_tx = COALESCE(@entryTx, entry_tx),
      exit_tx = COALESCE(@exitTx, exit_tx),
      entry_price_usd = COALESCE(@entryPriceUsd, entry_price_usd),
      exit_price_usd = COALESCE(@exitPriceUsd, exit_price_usd),
      pnl_usd = COALESCE(@pnlUsd, pnl_usd),
      max_seen_price_usd = COALESCE(@maxSeenPriceUsd, max_seen_price_usd),
      current_token_amount = COALESCE(@currentTokenAmount, current_token_amount),
      initial_token_amount = COALESCE(@initialTokenAmount, initial_token_amount),
      sniper_mode = COALESCE(@sniperMode, sniper_mode),
      tp_step = COALESCE(@tpStep, tp_step),
      stage = COALESCE(@stage, stage)
    WHERE id = @id;
  `);

  const openPositionsStmt = db.prepare(`SELECT * FROM positions WHERE status IN ('OPEN','EXITING');`);
  const openPositionByMintStmt = db.prepare(`SELECT * FROM positions WHERE status IN ('OPEN','EXITING') AND mint=? LIMIT 1;`);
  const positionByIdStmt = db.prepare(`SELECT * FROM positions WHERE id=? LIMIT 1;`);
  const countOpenPositionsStmt = db.prepare(`SELECT COUNT(1) as n FROM positions WHERE status IN ('OPEN','EXITING');`);
  const realizedPnlStmt = db.prepare(`SELECT COALESCE(SUM(pnl_usd), 0) as pnl FROM positions WHERE status='CLOSED' AND closed_at >= ?;`);
  const normalizeEnteringStmt = db.prepare(`UPDATE positions SET status='OPEN' WHERE status='ENTERING';`);

  const insertExecutionStmt = db.prepare(`
    INSERT INTO executions (
      id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
      ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
    ) VALUES (
      @id, @intentId, @positionId, @mint, @side, @mode, @requestedAt, @executedAt,
      @ok, @txSig, @err, @inAmount, @outAmount, @slippageBps, @rawJson
    );
  `);
  const insertExecutionAttemptStmt = db.prepare(`
    INSERT INTO execution_attempts (
      id, intent_id, position_id, mint, router, attempt_no, stage, ok, tx_sig, err,
      in_amount, out_amount, requested_at, executed_at, raw_json
    ) VALUES (
      @id, @intentId, @positionId, @mint, @router, @attemptNo, @stage, @ok, @txSig, @err,
      @inAmount, @outAmount, @requestedAt, @executedAt, @rawJson
    );
  `);
  const latestExecutionByIntentStmt = db.prepare(`
    SELECT id, raw_json
    FROM executions
    WHERE intent_id=?
    ORDER BY requested_at DESC, rowid DESC
    LIMIT 1;
  `);
  const updateExecutionRawStmt = db.prepare(`UPDATE executions SET raw_json=? WHERE id=?;`);
  const insertPositionLegStmt = db.prepare(`
    INSERT INTO position_legs (
      id, position_id, mint, side, intent_kind, requested_at, executed_at,
      in_amount, out_amount, ok, tx_sig, err, raw_json
    ) VALUES (
      @id, @positionId, @mint, @side, @intentKind, @requestedAt, @executedAt,
      @inAmount, @outAmount, @ok, @txSig, @err, @rawJson
    );
  `);
  const insertLifecycleEventStmt = db.prepare(`
    INSERT INTO trade_lifecycle_events (
      id, run_id, candidate_id, mint, position_id, intent_id, stage, at_ms, meta_json
    ) VALUES (
      @id, @runId, @candidateId, @mint, @positionId, @intentId, @stage, @atMs, @metaJson
    );
  `);
  const insertAttributionStmt = db.prepare(`
    INSERT INTO trade_attribution (
      id, position_id, mint, mode, opened_at, closed_at, hold_ms, pnl_usd, features_json
    ) VALUES (
      @id, @positionId, @mint, @mode, @openedAt, @closedAt, @holdMs, @pnlUsd, @featuresJson
    );
  `);
  const recentClosedPnlRowsStmt = db.prepare(`
    SELECT closed_at, pnl_usd
    FROM positions
    WHERE status='CLOSED' AND closed_at >= ? AND (? IS NULL OR mode=?)
    ORDER BY closed_at DESC
    LIMIT 200;
  `);
  const lifecycleByStageStmt = db.prepare(`
    SELECT candidate_id, intent_id, stage, at_ms
    FROM trade_lifecycle_events
    WHERE at_ms >= ? AND stage IN ('DETECTED','INTENT_CREATED','SENT','CONFIRMED')
    ORDER BY at_ms ASC;
  `);
  const leaderboardRowsStmt = db.prepare(`
    SELECT features_json, pnl_usd
    FROM trade_attribution
    WHERE closed_at >= ?
    ORDER BY closed_at DESC
    LIMIT 10000;
  `);

  function rowToPosition(r: any): Position {
    return {
      id: String(r.id),
      mint: String(r.mint),
      mode: r.mode === "live" ? "live" : "paper",
      status: String(r.status) as any,
      stage: (r.stage ? String(r.stage) : "FULL") as any,
      sniperMode: Number(r.sniper_mode ?? 0) === 1,
      tpStep: Number(r.tp_step ?? 0),
      openedAtMs: Number(r.opened_at),
      closedAtMs: r.closed_at === null ? undefined : Number(r.closed_at),
      baseMint: String(r.base_mint),
      entryBaseAmount: BigInt(r.entry_base_amount),
      entryTokenAmount: BigInt(r.entry_token_amount),
      initialTokenAmount: BigInt(r.initial_token_amount ?? r.entry_token_amount),
      currentTokenAmount: BigInt(r.current_token_amount ?? r.entry_token_amount),
      exitBaseAmount: r.exit_base_amount === null ? undefined : BigInt(r.exit_base_amount),
      entryTx: r.entry_tx ?? undefined,
      exitTx: r.exit_tx ?? undefined,
      entryPriceUsd: r.entry_price_usd ?? undefined,
      exitPriceUsd: r.exit_price_usd ?? undefined,
      pnlUsd: r.pnl_usd ?? undefined,
      maxSeenPriceUsd: r.max_seen_price_usd ?? undefined
    };
  }

  return {
    upsertToken: ({ mint, seenAtMs, source }) => {
      upsertTokenStmt.run({ mint, seenAt: seenAtMs, source });
    },
    insertSnapshot: ({ mint, capturedAtMs, pair }) => {
      const p = pair;
      insertSnapshotStmt.run({
        mint,
        capturedAt: capturedAtMs,
        pairAddress: p?.pairAddress ?? null,
        dexId: p?.dexId ?? null,
        url: p?.url ?? null,
        priceUsd: p?.priceUsd ? Number(p.priceUsd) : null,
        priceNative: p?.priceNative ? Number(p.priceNative) : null,
        liquidityUsd: p?.liquidityUsd ?? null,
        volumeM5: p?.volume?.m5 ?? null,
        volumeH1: p?.volume?.h1 ?? null,
        volumeH6: p?.volume?.h6 ?? null,
        volumeH24: p?.volume?.h24 ?? null,
        buysM5: p?.txns?.m5?.buys ?? null,
        sellsM5: p?.txns?.m5?.sells ?? null,
        buysH1: p?.txns?.h1?.buys ?? null,
        sellsH1: p?.txns?.h1?.sells ?? null,
        buysH6: p?.txns?.h6?.buys ?? null,
        sellsH6: p?.txns?.h6?.sells ?? null,
        buysH24: p?.txns?.h24?.buys ?? null,
        sellsH24: p?.txns?.h24?.sells ?? null,
        priceChangeM5: p?.priceChange?.m5 ?? null,
        priceChangeH1: p?.priceChange?.h1 ?? null,
        priceChangeH6: p?.priceChange?.h6 ?? null,
        priceChangeH24: p?.priceChange?.h24 ?? null,
        pairCreatedAt: p?.pairCreatedAt ?? null
      });
    },
    insertRiskReport: (report) => {
      insertRiskReportStmt.run({
        mint: report.mint,
        createdAt: report.createdAtMs,
        flagsJson: JSON.stringify(report.flags),
        riskScore: report.riskScore,
        opportunityScore: report.opportunityScore,
        tradeScore: report.tradeScore,
        metricsJson: JSON.stringify(report.metrics),
        reasonsJson: JSON.stringify(report.reasons)
      });
    },
    getLatestRiskReport: (mint) => {
      const r = latestRiskReportStmt.get(mint) as any;
      if (!r) return null;
      return {
        createdAtMs: Number(r.created_at),
        flags: JSON.parse(String(r.flags_json ?? "[]")),
        metrics: JSON.parse(String(r.metrics_json ?? "{}"))
      };
    },
    getLatestSnapshot: (mint) => {
      const r = latestSnapshotStmt.get(mint) as any;
      if (!r) return null;
      return {
        capturedAtMs: Number(r.captured_at),
        liquidityUsd: r.liquidity_usd === null ? null : Number(r.liquidity_usd),
        priceUsd: r.price_usd === null ? null : Number(r.price_usd),
        volumeM5Usd: r.volume_m5 === null ? null : Number(r.volume_m5),
        volumeH1Usd: r.volume_h1 === null ? null : Number(r.volume_h1),
        volumeH24Usd: r.volume_h24 === null ? null : Number(r.volume_h24)
      };
    },
    getRecentSnapshotsByMint: ({ mint, sinceMs, limit = 120 }) => {
      const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
      return (recentSnapshotsByMintStmt.all(mint, sinceMs, boundedLimit) as any[]).map((r) => ({
        capturedAtMs: Number(r.captured_at),
        priceUsd: r.price_usd === null ? null : Number(r.price_usd),
        liquidityUsd: r.liquidity_usd === null ? null : Number(r.liquidity_usd),
        volumeM5Usd: r.volume_m5 === null ? null : Number(r.volume_m5),
        volumeH1Usd: r.volume_h1 === null ? null : Number(r.volume_h1),
        volumeH24Usd: r.volume_h24 === null ? null : Number(r.volume_h24),
        buysM5: r.buys_m5 === null ? null : Number(r.buys_m5),
        sellsM5: r.sells_m5 === null ? null : Number(r.sells_m5)
      }));
    },
    setBlock: ({ mint, reason, expiresAtMs }) => {
      setBlockStmt.run({
        mint,
        reason,
        blockedAt: Date.now(),
        expiresAt: expiresAtMs
      });
    },
    isBlocked: (mint, nowMs) => {
      const row = getBlockStmt.get(mint) as any;
      if (!row) return false;
      return Number(row.expires_at) > nowMs;
    },
    getBlock: (mint, nowMs) => {
      const row = getBlockFullStmt.get(mint) as any;
      if (!row) return null;
      const expiresAtMs = Number(row.expires_at);
      if (expiresAtMs <= nowMs) return null;
      return { mint: String(row.mint), reason: String(row.reason), expiresAtMs };
    },
    deleteExpiredBlocks: (nowMs) => {
      const info = deleteExpiredBlocksStmt.run(nowMs);
      return Number(info.changes ?? 0);
    },
    createPosition: (p) => {
      createPositionStmt.run({
        id: p.id,
        mint: p.mint,
        mode: p.mode,
        status: p.status,
        openedAt: p.openedAtMs,
        closedAt: p.closedAtMs ?? null,
        baseMint: p.baseMint,
        entryBaseAmount: p.entryBaseAmount.toString(),
        entryTokenAmount: p.entryTokenAmount.toString(),
        exitBaseAmount: p.exitBaseAmount?.toString() ?? null,
        entryTx: p.entryTx ?? null,
        exitTx: p.exitTx ?? null,
        entryPriceUsd: p.entryPriceUsd ?? null,
        exitPriceUsd: p.exitPriceUsd ?? null,
        pnlUsd: p.pnlUsd ?? null,
        maxSeenPriceUsd: p.maxSeenPriceUsd ?? null,
        initialTokenAmount: p.initialTokenAmount.toString(),
        currentTokenAmount: p.currentTokenAmount.toString(),
        sniperMode: p.sniperMode ? 1 : 0,
        tpStep: p.tpStep,
        stage: p.stage
      });
    },
    updatePosition: (p) => {
      updatePositionStmt.run({
        id: p.id,
        status: (p as any).status ?? null,
        closedAtMs: (p as any).closedAtMs ?? null,
        entryBaseAmount:
          (p as any).entryBaseAmount === undefined || (p as any).entryBaseAmount === null
            ? null
            : (p as any).entryBaseAmount.toString(),
        entryTokenAmount:
          (p as any).entryTokenAmount === undefined || (p as any).entryTokenAmount === null
            ? null
            : (p as any).entryTokenAmount.toString(),
        exitBaseAmount:
          (p as any).exitBaseAmount === undefined || (p as any).exitBaseAmount === null
            ? null
            : (p as any).exitBaseAmount.toString(),
        entryTx: (p as any).entryTx ?? null,
        exitTx: (p as any).exitTx ?? null,
        entryPriceUsd: (p as any).entryPriceUsd ?? null,
        exitPriceUsd: (p as any).exitPriceUsd ?? null,
        pnlUsd: (p as any).pnlUsd ?? null,
        maxSeenPriceUsd: (p as any).maxSeenPriceUsd ?? null,
        currentTokenAmount:
          (p as any).currentTokenAmount === undefined || (p as any).currentTokenAmount === null
            ? null
            : (p as any).currentTokenAmount.toString(),
        initialTokenAmount:
          (p as any).initialTokenAmount === undefined || (p as any).initialTokenAmount === null
            ? null
            : (p as any).initialTokenAmount.toString(),
        sniperMode:
          (p as any).sniperMode === undefined || (p as any).sniperMode === null
            ? null
            : ((p as any).sniperMode ? 1 : 0),
        tpStep: (p as any).tpStep ?? null,
        stage: (p as any).stage ?? null
      });
    },
    getOpenPositions: () => {
      return openPositionsStmt.all().map(rowToPosition);
    },
    getOpenPositionByMint: (mint) => {
      const r = openPositionByMintStmt.get(mint) as any;
      return r ? rowToPosition(r) : null;
    },
    getPositionById: (id) => {
      const r = positionByIdStmt.get(id) as any;
      return r ? rowToPosition(r) : null;
    },
    countOpenPositions: () => {
      const r = countOpenPositionsStmt.get() as any;
      return Number(r.n);
    },
    realizedPnlUsdSince: (sinceMs) => {
      const r = realizedPnlStmt.get(sinceMs) as any;
      return Number(r.pnl ?? 0);
    },
    normalizeTransientPositionStates: () => {
      const info = normalizeEnteringStmt.run();
      return Number(info.changes ?? 0);
    },
    getConsecutiveLossStats: ({ sinceMs, mode, cooldownMinutes }) => {
      const rows = recentClosedPnlRowsStmt.all(sinceMs, mode ?? null, mode ?? null) as any[];
      let consecutiveLosses = 0;
      let lastLossClosedAtMs: number | undefined;
      for (const r of rows) {
        const pnl = r.pnl_usd === null ? null : Number(r.pnl_usd);
        if (pnl === null || Number.isNaN(pnl)) break;
        if (pnl < 0) {
          consecutiveLosses += 1;
          if (lastLossClosedAtMs === undefined) lastLossClosedAtMs = Number(r.closed_at);
        } else {
          break;
        }
      }
      if (!lastLossClosedAtMs || consecutiveLosses <= 0) return { consecutiveLosses: 0 };
      const blockedUntilMs = lastLossClosedAtMs + cooldownMinutes * 60_000;
      return { consecutiveLosses, blockedUntilMs };
    },
    insertExecution: (p) => {
      insertExecutionStmt.run({
        id: p.id,
        intentId: p.intentId,
        positionId: p.positionId ?? null,
        mint: p.mint,
        side: p.side,
        mode: p.mode,
        requestedAt: p.requestedAtMs,
        executedAt: p.executedAtMs ?? null,
        ok: p.ok ? 1 : 0,
        txSig: p.txSig ?? null,
        err: p.err ?? null,
        inAmount: p.inAmount?.toString() ?? null,
        outAmount: p.outAmount?.toString() ?? null,
        slippageBps: p.slippageBps ?? null,
        rawJson: p.raw ? JSON.stringify(p.raw) : null
      });
    },
    insertExecutionAttempt: (p) => {
      insertExecutionAttemptStmt.run({
        id: p.id,
        intentId: p.intentId,
        positionId: p.positionId ?? null,
        mint: p.mint,
        router: p.router,
        attemptNo: p.attemptNo,
        stage: p.stage,
        ok: p.ok ? 1 : 0,
        txSig: p.txSig ?? null,
        err: p.err ?? null,
        inAmount: p.inAmount?.toString() ?? null,
        outAmount: p.outAmount?.toString() ?? null,
        requestedAt: p.requestedAtMs,
        executedAt: p.executedAtMs ?? null,
        rawJson: p.raw ? JSON.stringify(p.raw) : null
      });
    },
    patchLatestExecutionRawByIntent: ({ intentId, patch }) => {
      const row = latestExecutionByIntentStmt.get(intentId) as { id?: string; raw_json?: string | null } | undefined;
      const id = row?.id ? String(row.id) : "";
      if (!id) return false;
      let base: Record<string, unknown> = {};
      if (row?.raw_json) {
        try {
          const parsed = JSON.parse(String(row.raw_json)) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            base = parsed as Record<string, unknown>;
          }
        } catch {
          base = {};
        }
      }
      updateExecutionRawStmt.run(JSON.stringify({ ...base, ...patch }), id);
      return true;
    },
    insertPositionLeg: (p) => {
      insertPositionLegStmt.run({
        id: p.id,
        positionId: p.positionId,
        mint: p.mint,
        side: p.side,
        intentKind: p.intentKind,
        requestedAt: p.requestedAtMs,
        executedAt: p.executedAtMs ?? null,
        inAmount: p.inAmount?.toString() ?? null,
        outAmount: p.outAmount?.toString() ?? null,
        ok: p.ok ? 1 : 0,
        txSig: p.txSig ?? null,
        err: p.err ?? null,
        rawJson: p.raw ? JSON.stringify(p.raw) : null
      });
    },
    insertLifecycleEvent: (p) => {
      insertLifecycleEventStmt.run({
        id: p.id,
        runId: p.runId ?? null,
        candidateId: p.candidateId ?? null,
        mint: p.mint,
        positionId: p.positionId ?? null,
        intentId: p.intentId ?? null,
        stage: p.stage,
        atMs: p.atMs,
        metaJson: p.meta ? JSON.stringify(p.meta) : null
      });
    },
    insertTradeAttribution: (p) => {
      insertAttributionStmt.run({
        id: p.id,
        positionId: p.positionId,
        mint: p.mint,
        mode: p.mode,
        openedAt: p.openedAtMs,
        closedAt: p.closedAtMs,
        holdMs: p.holdMs,
        pnlUsd: p.pnlUsd ?? null,
        featuresJson: JSON.stringify(p.features ?? {})
      });
    },
    getLatencyStats: (windowMinutes, mode = "candidate_intent_position") => {
      const nowMs = Date.now();
      const sinceMs = nowMs - Math.max(1, Math.floor(windowMinutes)) * 60_000;
      const rows = lifecycleByStageStmt.all(sinceMs) as Array<{
        candidate_id: string | null;
        intent_id: string | null;
        stage: string;
        at_ms: number;
      }>;
      const byCandidate = new Map<string, Record<string, number>>();
      const byIntent = new Map<string, Record<string, number>>();
      for (const r of rows) {
        const atMs = Number(r.at_ms);
        const candidateId = r.candidate_id ? String(r.candidate_id) : "";
        if (candidateId) {
          const rec = byCandidate.get(candidateId) ?? {};
          const existing = rec[r.stage];
          if (existing === undefined || atMs < existing) rec[r.stage] = atMs;
          byCandidate.set(candidateId, rec);
        }

        const intentId = r.intent_id ? String(r.intent_id) : "";
        if (intentId) {
          const rec = byIntent.get(intentId) ?? {};
          const existing = rec[r.stage];
          if (existing === undefined || atMs < existing) rec[r.stage] = atMs;
          byIntent.set(intentId, rec);
        }
      }

      const detectToIntent: number[] = [];
      const sentToConfirmed: number[] = [];
      for (const rec of byCandidate.values()) {
        if (rec.DETECTED !== undefined && rec.INTENT_CREATED !== undefined && rec.INTENT_CREATED >= rec.DETECTED) {
          detectToIntent.push(rec.INTENT_CREATED - rec.DETECTED);
        }
      }
      for (const rec of byIntent.values()) {
        if (rec.SENT !== undefined && rec.CONFIRMED !== undefined && rec.CONFIRMED >= rec.SENT) {
          sentToConfirmed.push(rec.CONFIRMED - rec.SENT);
        }
      }
      return {
        mode,
        sampleSize: Math.max(detectToIntent.length, sentToConfirmed.length),
        detectToIntentSamples: detectToIntent.length,
        sentToConfirmedSamples: sentToConfirmed.length,
        detectToIntentMs: {
          p50: percentile(detectToIntent, 50),
          p95: percentile(detectToIntent, 95)
        },
        sentToConfirmedMs: {
          p50: percentile(sentToConfirmed, 50),
          p95: percentile(sentToConfirmed, 95)
        }
      };
    },
    getAttributionLeaderboard: (limit) => {
      const nowMs = Date.now();
      const sinceMs = nowMs - 7 * 24 * 60 * 60 * 1000;
      const rows = leaderboardRowsStmt.all(sinceMs) as Array<{ features_json: string; pnl_usd: number | null }>;
      const buckets = new Map<string, { trades: number; wins: number; totalPnlUsd: number }>();
      for (const r of rows) {
        let key = "unknown";
        try {
          const f = JSON.parse(String(r.features_json ?? "{}")) as any;
          key = String(f.entryPath ?? f.detectSource ?? "unknown");
        } catch {
          key = "unknown";
        }
        const b = buckets.get(key) ?? { trades: 0, wins: 0, totalPnlUsd: 0 };
        b.trades += 1;
        const pnl = Number(r.pnl_usd ?? 0);
        b.totalPnlUsd += Number.isFinite(pnl) ? pnl : 0;
        if (pnl > 0) b.wins += 1;
        buckets.set(key, b);
      }
      return [...buckets.entries()]
        .map(([key, b]) => ({
          key,
          trades: b.trades,
          winRate: b.trades > 0 ? b.wins / b.trades : 0,
          avgPnlUsd: b.trades > 0 ? b.totalPnlUsd / b.trades : 0,
          totalPnlUsd: b.totalPnlUsd
        }))
        .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd)
        .slice(0, Math.max(1, Math.floor(limit)));
    }
  };
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  const v = sorted[idx];
  return v === undefined ? null : v;
}
