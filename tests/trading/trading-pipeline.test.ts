import { describe, expect, it, vi } from "vitest";
import { runTradingPipeline } from "../../tools/trading/trading-pipeline";

const CANSLIM_NO_BUY = `📈 Trading Advisor - CANSLIM Scan
Market: correction | Position Sizing: 0%
Summary: 1 candidates | BUY 0 | WATCH 1 | NO_BUY 0
• AAPL (7/12) → WATCH
  Watch setup`;

const DIP_NO_BUY = `📉 Trading Advisor - Dip Buyer Scan
Market: correction | Position Sizing: 50%
Summary: 1 candidates | BUY 0 | WATCH 1 | NO_BUY 0
• TSLA (8/12) → WATCH
  Watch setup`;

const CANSLIM_BUY = `📈 Trading Advisor - CANSLIM Scan
Market: confirmed_uptrend | Position Sizing: 100%
Summary: 1 candidates | BUY 1 | WATCH 0 | NO_BUY 0
• NVDA (9/12) → BUY
  Entry $900.00 | Stop $855.00`;

const DIP_BUY = `📉 Trading Advisor - Dip Buyer Scan
Market: uptrend_under_pressure | Position Sizing: 50%
Summary: 1 candidates | BUY 1 | WATCH 0 | NO_BUY 0
• TSLA (8/12) → BUY
  Entry $200.00 | Stop $186.00`;

describe("trading pipeline orchestration", () => {
  it("does not call council when no BUY signals are present", async () => {
    const council = vi.fn(async () => ({ verdicts: [] }));

    const report = await runTradingPipeline({
      runCommand: (_cmd, args) => (args[0] === "canslim_alert.py" ? CANSLIM_NO_BUY : DIP_NO_BUY),
      council,
    });

    expect(council).not.toHaveBeenCalled();
    expect(report).toContain("Summary: BUY 0 | WATCH 2 | NO_BUY 0");
  });

  it("calls council when BUY signals are present", async () => {
    const council = vi.fn(async () => ({
      verdicts: [
        {
          ticker: "NVDA",
          sessionId: "s1",
          approved: true,
          approveCount: 2,
          totalVotes: 3,
          avgConfidence: 0.77,
          synthesis: "Momentum and risk vote to proceed with caution.",
        },
      ],
    }));

    const report = await runTradingPipeline({
      runCommand: (_cmd, args) => (args[0] === "canslim_alert.py" ? CANSLIM_BUY : DIP_NO_BUY),
      council,
    });

    expect(council).toHaveBeenCalledTimes(1);
    expect(report).toContain("🏛️ Council (BUY signals only):");
    expect(report).toContain("NVDA: APPROVED");
  });

  it("shows correction shadow mode watch section", async () => {
    const report = await runTradingPipeline({
      runCommand: (_cmd, args) => (args[0] === "canslim_alert.py" ? CANSLIM_NO_BUY : DIP_NO_BUY),
      council: async () => ({ verdicts: [] }),
    });

    expect(report).toContain("👁️ Shadow Mode (Correction): top WATCH only, no execution changes");
    expect(report).toContain("AAPL");
    expect(report).toContain("TSLA");
  });

  it("calls council for each scanner that has BUY signals", async () => {
    const council = vi.fn(async () => ({ verdicts: [] }));

    await runTradingPipeline({
      runCommand: (_cmd, args) => (args[0] === "canslim_alert.py" ? CANSLIM_BUY : DIP_BUY),
      council,
    });

    expect(council).toHaveBeenCalledTimes(2);
  });
});
