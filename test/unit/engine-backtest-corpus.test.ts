// Root-suite coverage driver for the engine's backtest-corpus builder (#8083). The engine's own node:test
// suite (packages/loopover-engine/test/backtest-corpus.test.ts) validates behavior against the built barrel,
// but codecov/patch is produced by THIS root vitest run — so the source file is exercised here (imported by
// relative source path, the same way alerts-miner-prediction-calibration-drift.test.ts drives coverage of its
// engine module) to cover every branch of the pairing logic.
import { describe, expect, it } from "vitest";
import { buildBacktestCorpus } from "../../packages/loopover-engine/src/calibration/backtest-corpus";
import type { HumanOverrideEvent, RuleFiredEvent } from "../../packages/loopover-engine/src/calibration/signal-tracking";

const fired = (ruleId: string, targetKey: string, o: Partial<RuleFiredEvent> = {}): RuleFiredEvent => ({
  ruleId,
  targetKey,
  outcome: "block",
  occurredAt: "2026-07-22T00:00:00.000Z",
  ...o,
});
const override = (
  ruleId: string,
  targetKey: string,
  verdict: HumanOverrideEvent["verdict"],
  o: Partial<HumanOverrideEvent> = {},
): HumanOverrideEvent => ({ ruleId, targetKey, verdict, occurredAt: "2026-07-22T00:00:00.000Z", ...o });

describe("buildBacktestCorpus (#8083)", () => {
  it("returns an empty corpus for empty inputs", () => {
    expect(buildBacktestCorpus("r", [], [])).toEqual([]);
  });

  it("excludes a fired event that has no matching override (undecided is not unlabeled)", () => {
    const corpus = buildBacktestCorpus(
      "missing_linked_issue",
      [fired("missing_linked_issue", "a#1"), fired("missing_linked_issue", "a#2")],
      [override("missing_linked_issue", "a#1", "confirmed", { occurredAt: "2026-07-22T01:00:00.000Z" })],
    );
    expect(corpus).toEqual([
      {
        ruleId: "missing_linked_issue",
        targetKey: "a#1",
        outcome: "block",
        label: "confirmed",
        firedAt: "2026-07-22T00:00:00.000Z",
        decidedAt: "2026-07-22T01:00:00.000Z",
      },
    ]);
  });

  it("labels a single fired+override pair from the override's verdict and the fired event's outcome", () => {
    const corpus = buildBacktestCorpus(
      "r",
      [fired("r", "a#7", { outcome: "exclude" })],
      [override("r", "a#7", "reversed", { occurredAt: "2026-07-22T02:00:00.000Z" })],
    );
    expect(corpus).toHaveLength(1);
    expect(corpus[0]).toMatchObject({ label: "reversed", outcome: "exclude", decidedAt: "2026-07-22T02:00:00.000Z" });
    expect("metadata" in corpus[0]!).toBe(false);
  });

  it("carries the fired event's metadata verbatim when present", () => {
    const corpus = buildBacktestCorpus(
      "r",
      [fired("r", "a#1", { metadata: { source: "orb", n: 3 } })],
      [override("r", "a#1", "confirmed", { occurredAt: "2026-07-22T01:00:00.000Z" })],
    );
    expect(corpus[0]!.metadata).toEqual({ source: "orb", n: 3 });
  });

  it("ignores events for a different ruleId on both the fired and override sides", () => {
    const corpus = buildBacktestCorpus(
      "wanted",
      [fired("wanted", "a#1"), fired("other", "a#1")],
      [
        override("wanted", "a#1", "confirmed", { occurredAt: "2026-07-22T01:00:00.000Z" }),
        override("other", "a#1", "reversed", { occurredAt: "2026-07-22T01:00:00.000Z" }),
      ],
    );
    expect(corpus).toHaveLength(1);
    expect(corpus[0]).toMatchObject({ ruleId: "wanted", label: "confirmed" });
  });

  it("pairs the nearest override strictly AFTER the fire, ignoring earlier and farther-later overrides", () => {
    const corpus = buildBacktestCorpus(
      "r",
      [fired("r", "a#1", { occurredAt: "2026-07-22T12:00:00.000Z" })],
      [
        override("r", "a#1", "reversed", { occurredAt: "2026-07-22T10:00:00.000Z" }), // before the fire -> ignored as "following"
        override("r", "a#1", "confirmed", { occurredAt: "2026-07-22T13:00:00.000Z" }), // nearest after -> chosen
        override("r", "a#1", "reversed", { occurredAt: "2026-07-22T18:00:00.000Z" }), // later after, not closer
      ],
    );
    expect(corpus[0]).toMatchObject({ label: "confirmed", decidedAt: "2026-07-22T13:00:00.000Z" });
  });

  it("still selects the nearest-following override when a closer one appears later in the list", () => {
    // Descending order so the FIRST following found (18:00) is replaced by a closer later-iterated one (13:00).
    const corpus = buildBacktestCorpus(
      "r",
      [fired("r", "a#1", { occurredAt: "2026-07-22T12:00:00.000Z" })],
      [
        override("r", "a#1", "reversed", { occurredAt: "2026-07-22T18:00:00.000Z" }),
        override("r", "a#1", "confirmed", { occurredAt: "2026-07-22T13:00:00.000Z" }),
      ],
    );
    expect(corpus[0]).toMatchObject({ label: "confirmed", decidedAt: "2026-07-22T13:00:00.000Z" });
  });

  it("falls back to the most recent override when none strictly follows the fire", () => {
    const corpus = buildBacktestCorpus(
      "r",
      [fired("r", "a#1", { occurredAt: "2026-07-22T20:00:00.000Z" })],
      [
        override("r", "a#1", "reversed", { occurredAt: "2026-07-22T10:00:00.000Z" }),
        override("r", "a#1", "confirmed", { occurredAt: "2026-07-22T15:00:00.000Z" }), // most recent, still before -> chosen
      ],
    );
    expect(corpus[0]).toMatchObject({ label: "confirmed", decidedAt: "2026-07-22T15:00:00.000Z" });
  });
});
