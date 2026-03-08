import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { modelPaperBuy, modelPaperSell } from "../../src/execution/paperModel";

describe("paper model", () => {
  test("conservative model applies adverse bps and network fee", () => {
    const cfg = loadAppConfig("config/default.json");
    const buy = modelPaperBuy({
      cfg,
      quoteOutAmount: 1000n,
      quoteInAmount: 10_000n
    });
    expect(buy.tokenOut).toBe(993n);
    expect(buy.entryBaseCost).toBe(22_000n);

    const sell = modelPaperSell({
      cfg,
      quoteOutAmount: 200_000n
    });
    expect(sell.baseOut).toBe(186_200n);
  });

  test("light model disables adverse haircut", () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.paper.model = "light";

    const buy = modelPaperBuy({
      cfg,
      quoteOutAmount: 1000n,
      quoteInAmount: 10_000n
    });
    expect(buy.tokenOut).toBe(1000n);
    expect(buy.entryBaseCost).toBe(22_000n);
  });
});
