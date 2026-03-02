import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importFresh, mockExit, resetProcess, setArgv } from "../test-utils";

type StockModule = {
  fetchQuote: (symbol: string) => Promise<any>;
  fetchQuoteYahoo: (symbol: string) => Promise<any>;
  fetchQuoteStooq: (symbol: string) => Promise<any>;
};

async function loadModule(fetchMock: ReturnType<typeof vi.fn>): Promise<StockModule> {
  mockExit();
  setArgv(["analyze", "DUMMY", "--json"]);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const primeFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      quoteResponse: {
        result: [
          {
            regularMarketPrice: 1,
            regularMarketChangePercent: 0,
            currency: "USD",
            regularMarketTime: 1,
          },
        ],
      },
    }),
  });
  vi.stubGlobal("fetch", primeFetch);
  const mod = (await importFresh("../../skills/stock-analysis/src/stock_analysis/main.ts")) as StockModule;
  vi.stubGlobal("fetch", fetchMock);
  logSpy.mockRestore();
  return mod;
}

describe("stock-analysis main", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetProcess();
  });

  it("normalizes Stooq symbols for BRK.B, TSLA, BRK.A", async () => {
    fetchMock.mockImplementation(async () => ({
      text: async () => "TSLA,2024-01-02,00:00:00,1,2,3,4,5",
    }));

    const mod = await loadModule(fetchMock);
    await mod.fetchQuoteStooq("BRK.B");
    await mod.fetchQuoteStooq("TSLA");
    await mod.fetchQuoteStooq("BRK.A");

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      "https://stooq.com/q/l/?s=brk-b.us&i=d",
      "https://stooq.com/q/l/?s=tsla.us&i=d",
      "https://stooq.com/q/l/?s=brk-a.us&i=d",
    ]);
  });

  it("returns expected Yahoo shape with source=yahoo", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        quoteResponse: {
          result: [
            {
              regularMarketPrice: 123.45,
              regularMarketChangePercent: 0.42,
              currency: "USD",
              regularMarketTime: 1700000000,
            },
          ],
        },
      }),
    });

    const mod = await loadModule(fetchMock);
    const data = await mod.fetchQuoteYahoo("tsla");
    expect(data).toEqual({
      symbol: "TSLA",
      price: 123.45,
      change_percent: 0.42,
      signal: "neutral",
      currency: "USD",
      as_of: 1700000000,
      source: "yahoo",
    });
  });

  it("falls back to Stooq when Yahoo fails", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        text: async () => "TSLA,2024-01-02,00:00:00,1,2,3,4,5",
      });

    const mod = await loadModule(fetchMock);
    const data = await mod.fetchQuote("TSLA");
    expect(data.source).toBe("stooq");
    expect(data.price).toBe(4);
  });

  it("throws when both Yahoo and Stooq fail", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        text: async () => "TSLA,2024-01-02,00:00:00",
      });

    const mod = await loadModule(fetchMock);
    await expect(mod.fetchQuote("TSLA")).rejects.toThrow(/Invalid stooq close/);
  });

  it("applies signal thresholds for bullish, bearish, and neutral", async () => {
    const mod = await loadModule(fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quoteResponse: {
          result: [
            {
              regularMarketPrice: 1,
              regularMarketChangePercent: 1.5,
              currency: "USD",
              regularMarketTime: 1,
            },
          ],
        },
      }),
    });
    const bullish = await mod.fetchQuoteYahoo("AAPL");
    expect(bullish.signal).toBe("bullish");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quoteResponse: {
          result: [
            {
              regularMarketPrice: 1,
              regularMarketChangePercent: -1.5,
              currency: "USD",
              regularMarketTime: 1,
            },
          ],
        },
      }),
    });
    const bearish = await mod.fetchQuoteYahoo("AAPL");
    expect(bearish.signal).toBe("bearish");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quoteResponse: {
          result: [
            {
              regularMarketPrice: 1,
              regularMarketChangePercent: 0.2,
              currency: "USD",
              regularMarketTime: 1,
            },
          ],
        },
      }),
    });
    const neutral = await mod.fetchQuoteYahoo("AAPL");
    expect(neutral.signal).toBe("neutral");
  });

  it("throws on invalid Stooq CSV rows", async () => {
    const mod = await loadModule(fetchMock);

    fetchMock.mockResolvedValueOnce({
      text: async () => "TSLA,2024-01-02,00:00:00,1,2,3,N/D,5",
    });
    await expect(mod.fetchQuoteStooq("TSLA")).rejects.toThrow(/Invalid stooq close/);

    fetchMock.mockResolvedValueOnce({
      text: async () => "TSLA,2024-01-02,00:00:00",
    });
    await expect(mod.fetchQuoteStooq("TSLA")).rejects.toThrow(/Invalid stooq close/);
  });
});
