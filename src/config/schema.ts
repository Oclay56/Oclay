import { z } from "zod";
import { isRiskFlag } from "../domain/flags";

const weightsSchema = z.record(z.string(), z.number().nonnegative()).superRefine((weights, ctx) => {
  for (const k of Object.keys(weights)) {
    if (!isRiskFlag(k)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown risk flag weight key: ${k}`
      });
    }
  }
});

export const configSchema = z.object({
  assets: z.object({
    baseAssetMint: z.string().min(32),
    quoteAssetMint: z.string().min(32)
  }),
  discovery: z.object({
    pollIntervalMs: z.number().int().positive(),
    fallbackPollIntervalMs: z.number().int().positive().default(20_000),
    maxNewTokensPerPoll: z.number().int().positive(),
    pairCacheTtlMs: z.number().int().positive(),
    minPairLiquidityUsd: z.number().nonnegative(),
    dexAllowlist: z.array(z.string().min(1)).default([]),
    stream: z
      .object({
        enabled: z.boolean().default(true),
        provider: z.literal("helius_ws").default("helius_ws"),
        parseMode: z.enum(["hybrid_strict", "instruction_only", "heuristic_only"]).default("hybrid_strict"),
        minCandidateConfidence: z.number().min(0).max(1).default(0.7),
        decoderStrictMode: z.boolean().default(true),
        decoderFallbackConfidenceFloor: z.number().min(0).max(1).default(0.8),
        emitEventKinds: z
          .array(z.enum(["POOL_CREATE", "LIQ_ADD", "EARLY_SWAP"]))
          .default(["POOL_CREATE", "LIQ_ADD", "EARLY_SWAP"]),
        reconnectMinMs: z.number().int().positive().default(1_000),
        reconnectMaxMs: z.number().int().positive().default(30_000),
        staleFailoverMs: z.number().int().positive().default(15_000),
        maxCandidatesPerMinute: z.number().int().positive().default(300),
        programAllowlist: z
          .array(z.string().min(32))
          .default([
            "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7", // Raydium CPMM
            "CAMMCzo5YL8w4VFF8KVHrK22GGUQxZ3Gx2wQv6qf9A8", // Raydium CLMM
            "Eo7WjKq67rjJQS1n3rY7AEvtTDHkJNNZ4wNGyreAx7An" // Meteora DLMM
          ])
      })
      .default({
        enabled: true,
        provider: "helius_ws",
        parseMode: "hybrid_strict",
        minCandidateConfidence: 0.7,
        decoderStrictMode: true,
        decoderFallbackConfidenceFloor: 0.8,
        emitEventKinds: ["POOL_CREATE", "LIQ_ADD", "EARLY_SWAP"],
        reconnectMinMs: 1_000,
        reconnectMaxMs: 30_000,
        staleFailoverMs: 15_000,
        maxCandidatesPerMinute: 300,
        programAllowlist: [
          "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7",
          "CAMMCzo5YL8w4VFF8KVHrK22GGUQxZ3Gx2wQv6qf9A8",
          "Eo7WjKq67rjJQS1n3rY7AEvtTDHkJNNZ4wNGyreAx7An"
        ]
      })
  }),
  analysis: z.object({
    entryTestAmountLamports: z.number().int().positive(),
    exitTestSlippageBps: z.number().int().min(0).max(10_000),
    maxImpliedRoundTripLossBps: z.number().int().min(0).max(10_000),
    rejectIfMintAuthority: z.boolean(),
    rejectIfFreezeAuthority: z.boolean(),
    rejectIfToken2022TransferHook: z.boolean(),
    rejectIfToken2022NonTransferable: z.boolean(),
    rejectIfToken2022DefaultFrozen: z.boolean(),
    maxToken2022TransferFeeBps: z.number().int().min(0).max(10_000),
    minLiquidityUsd: z.number().nonnegative(),
    minVolumeH24Usd: z.number().nonnegative(),
    minMarketAgeMinutes: z.number().nonnegative(),
    maxMarketAgeMinutes: z.number().nonnegative(),
    skipDeepChecksOnHardReject: z.boolean().default(true),
    holders: z.object({
      maxTop1Pct: z.number().min(0).max(100),
      maxTop10Pct: z.number().min(0).max(100),
      rateLimitCooldownMs: z.number().int().positive().default(120_000),
      cacheTtlMs: z.number().int().positive().default(120_000)
    })
  }),
  strategy: z.object({
    entryThreshold: z.number(),
    riskWeight: z.number().positive(),
    weights: weightsSchema,
    entry: z
      .object({
        minLiquidityUsd: z.number().nonnegative().default(50_000),
        maxMarketAgeMinutes: z.number().int().positive().default(60),
        maxTop1HolderPct: z.number().min(0).max(100).default(20),
        minVolumeM5Usd: z.number().nonnegative().default(2_500),
        minVolumeSpikeRatioM5VsH1Avg: z.number().min(1).default(4),
        minBuySellRatioM5: z.number().min(0).default(1.05),
        requirePullbackBounce: z.boolean().default(true),
        pullbackLookbackMinutes: z.number().int().positive().default(30),
        pullbackMinPct: z.number().min(0).max(100).default(10),
        pullbackMaxPct: z.number().min(0).max(100).default(20),
        baseLookbackSnapshots: z.number().int().min(3).default(5),
        baseMaxLowRangePct: z.number().min(0).max(100).default(3),
        bounceMinReboundPct: z.number().min(0).max(100).default(2),
        requireVolumeConfirmation: z.boolean().default(true),
        volumeConfirmLookbackSnapshots: z.number().int().min(2).default(10),
        volumeConfirmMultiplier: z.number().min(1).default(1.5),
        requireDemandZone: z.boolean().default(false),
        demandZoneBandPct: z.number().min(0).max(100).default(8),
        demandZoneLookbackMinutes: z.number().int().positive().default(45),
        demandZoneMinSnapshots: z.number().int().min(2).default(2)
      })
      .default({
        minLiquidityUsd: 50_000,
        maxMarketAgeMinutes: 60,
        maxTop1HolderPct: 20,
        minVolumeM5Usd: 2_500,
        minVolumeSpikeRatioM5VsH1Avg: 4,
        minBuySellRatioM5: 1.05,
        requirePullbackBounce: true,
        pullbackLookbackMinutes: 30,
        pullbackMinPct: 10,
        pullbackMaxPct: 20,
        baseLookbackSnapshots: 5,
        baseMaxLowRangePct: 3,
        bounceMinReboundPct: 2,
        requireVolumeConfirmation: true,
        volumeConfirmLookbackSnapshots: 10,
        volumeConfirmMultiplier: 1.5,
        requireDemandZone: false,
        demandZoneBandPct: 8,
        demandZoneLookbackMinutes: 45,
        demandZoneMinSnapshots: 2
      }),
    portfolio: z.object({
      maxOpenPositions: z.number().int().positive(),
      maxPositionNotionalUsd: z.number().positive(),
      maxDailyLossUsd: z.number().positive(),
      maxLiveCapitalUsd: z.number().nonnegative().default(0),
      consecutiveLossLimit: z.number().int().min(1).default(3),
      consecutiveLossCooldownMinutes: z.number().int().min(1).default(45)
    }),
    sniper: z
      .object({
        enabled: z.boolean().default(true),
        initialEntryPct: z.number().min(1).max(100).default(25),
        scaleDelayMs: z.number().int().positive().default(30_000),
        scaleEntryPct: z.number().min(1).max(100).default(75),
        maxHoldMinutes: z.number().int().min(1).default(6),
        maxLiquidityDegradePctBeforeScale: z.number().min(0).max(100).default(8),
        requireStableSellRoute: z.boolean().default(true),
        requireStageBForScale: z.boolean().default(true),
        stageBMaxWaitMs: z.number().int().positive().default(90_000),
        stageBPollMs: z.number().int().positive().default(5_000)
      })
      .default({
        enabled: true,
        initialEntryPct: 25,
        scaleDelayMs: 30_000,
        scaleEntryPct: 75,
        maxHoldMinutes: 6,
        maxLiquidityDegradePctBeforeScale: 8,
        requireStableSellRoute: true,
        requireStageBForScale: true,
        stageBMaxWaitMs: 90_000,
        stageBPollMs: 5_000
      }),
    exits: z.object({
      stopLossBps: z.number().int().min(0).max(50_000),
      takeProfitBps: z.number().int().min(0).max(50_000),
      trailingStopBps: z.number().int().min(0).max(50_000),
      maxHoldMinutes: z.number().int().min(0),
      tpLadderPercents: z.array(z.number().min(1).max(100)).length(3).default([30, 30, 40]),
      tpLadderTriggerBps: z.array(z.number().int().min(1).max(50_000)).length(3).default([1200, 2500, 4000]),
      trailingAfterTp1Bps: z.number().int().min(0).max(50_000).default(700),
      supplyZoneBandPct: z.number().min(0).max(100).default(8),
      supplyZoneLookbackMinutes: z.number().int().positive().default(60),
      supplyZoneMinSnapshots: z.number().int().min(2).default(3)
    })
  }),
  execution: z.object({
    slippageBpsEntry: z.number().int().min(0).max(10_000),
    slippageBpsExit: z.number().int().min(0).max(10_000),
    maxRetries: z.number().int().min(0).max(50),
    confirmTimeoutMs: z.number().int().positive(),
    sellAmountBufferBps: z.number().int().min(0).max(2_000),
    walletReserveLamports: z.number().int().min(0),
    positionDustAtoms: z.number().int().min(0),
    txFeeLamportsEstimate: z.number().int().positive(),
    landing: z
      .object({
        skipPreflightOnSend: z.boolean().default(true),
        statusPollIntervalMs: z.number().int().positive().default(750),
        resendIntervalMs: z.number().int().positive().default(2_000),
        maxResendsPerAttempt: z.number().int().min(0).default(2),
        retryBaseDelayMs: z.number().int().positive().default(500),
        retryMaxDelayMs: z.number().int().positive().default(6_000)
      })
      .default({
        skipPreflightOnSend: true,
        statusPollIntervalMs: 750,
        resendIntervalMs: 2_000,
        maxResendsPerAttempt: 2,
        retryBaseDelayMs: 500,
        retryMaxDelayMs: 6_000
      }),
    router: z
      .object({
        entryMode: z.enum(["raydium_first", "jupiter_only"]).default("raydium_first"),
        raydium: z
          .object({
            enabled: z.boolean().default(true),
            directEntryEnabled: z.boolean().default(false),
            supportedPoolKinds: z.array(z.enum(["cpmm", "clmm"])).default(["cpmm"]),
            poolKindPriority: z.array(z.literal("cpmm")).default(["cpmm"])
          })
          .default({ enabled: true, directEntryEnabled: false, supportedPoolKinds: ["cpmm"], poolKindPriority: ["cpmm"] })
      })
      .default({
        entryMode: "raydium_first",
        raydium: { enabled: true, directEntryEnabled: false, supportedPoolKinds: ["cpmm"], poolKindPriority: ["cpmm"] }
      }),
    sell429: z
      .object({
        perMintBaseCooldownMs: z.number().int().positive().default(12_000),
        perMintMaxCooldownMs: z.number().int().positive().default(180_000),
        backoffFactor: z.number().min(1).default(2),
        jitterPct: z.number().min(0).max(1).default(0.2),
        globalWindowMs: z.number().int().positive().default(30_000),
        globalTripCount: z.number().int().min(1).default(3),
        globalCooldownMs: z.number().int().positive().default(15_000)
      })
      .default({
        perMintBaseCooldownMs: 12_000,
        perMintMaxCooldownMs: 180_000,
        backoffFactor: 2,
        jitterPct: 0.2,
        globalWindowMs: 30_000,
        globalTripCount: 3,
        globalCooldownMs: 15_000
      })
  }),
  probe: z.object({
    enabled: z.boolean(),
    maxNotionalLamports: z.number().int().positive(),
    cooldownMinutesOnFailure: z.number().int().min(1),
    requiredInLive: z.boolean().default(true),
    successCacheMinutes: z.number().int().min(1).default(60)
  }),
  paper: z.object({
    model: z.enum(["conservative", "light", "high"]).default("conservative"),
    adverseEntryBps: z.number().int().min(0).max(10_000).default(70),
    adverseExitBps: z.number().int().min(0).max(10_000).default(90),
    fixedNetworkFeeLamportsPerSwap: z.number().int().min(0).default(12_000),
    highModelImpactMultiplier: z.number().min(1).max(5).default(1.25)
  }),
  guardian: z.object({
    intervalMs: z.number().int().positive(),
    liquidityDrainPct: z.number().min(0).max(100),
    volumeDropM5Pct: z.number().min(0).max(100).default(70),
    minPreviousVolumeM5Usd: z.number().nonnegative().default(1_000)
  }),
  telemetry: z
    .object({
      enabled: z.boolean().default(true),
      latencyWindowMinutes: z.number().int().positive().default(60),
      latencyKeyModel: z.literal("candidate_intent_position").default("candidate_intent_position")
    })
    .default({
      enabled: true,
      latencyWindowMinutes: 60,
      latencyKeyModel: "candidate_intent_position"
    })
});

export type AppConfig = z.infer<typeof configSchema>;
