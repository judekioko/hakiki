import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkTerms, depreciationForMonth, lastDayOfMonth, monthNumber, projectedSchedule, type Terms } from "../lib/depreciation";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const total = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
const straight = (over: Partial<Terms> = {}): Terms => ({ cost: 12000, salvage: 0, method: "STRAIGHT_LINE", lifeMonths: 12, annualRate: null, prior: 0, ...over });

describe("straight-line depreciation", () => {
  it("writes off the same amount every month", () => {
    const rows = projectedSchedule(straight(), day("2026-01-31"), 1, 0);
    assert.equal(rows.length, 12);
    assert.ok(rows.every((r) => r.amount === 1000));
    assert.equal(rows[11].accumulated, 12000);
  });

  it("lands exactly on the cost when the monthly amount does not divide evenly", () => {
    const rows = projectedSchedule(straight({ cost: 1000, lifeMonths: 3 }), day("2026-01-31"), 1, 0);
    assert.deepEqual(rows.map((r) => r.amount), [333.33, 333.33, 333.34]);
    assert.equal(total(rows), 1000);
  });

  it("keeps the salvage value", () => {
    assert.equal(total(projectedSchedule(straight({ salvage: 2000, lifeMonths: 10 }), day("2026-01-31"), 1, 0)), 10000);
  });

  it("continues from depreciation already booked elsewhere", () => {
    const rows = projectedSchedule(straight({ cost: 10000, lifeMonths: 10, prior: 4000 }), day("2026-01-31"), 1, 4000);
    assert.equal(rows.length, 6);
    assert.equal(total(rows), 6000);
  });

  it("charges nothing once fully depreciated", () => {
    assert.equal(depreciationForMonth(straight(), 13, 12000), 0);
  });
});

describe("reducing-balance depreciation", () => {
  const terms: Terms = { cost: 10000, salvage: 1000, method: "REDUCING_BALANCE", lifeMonths: null, annualRate: 25, prior: 0 };

  it("takes a share of what is left each month", () => {
    assert.equal(depreciationForMonth(terms, 1, 0), 208.33);
    assert.ok(depreciationForMonth(terms, 2, 208.33) < 208.33);
  });

  it("never goes below the salvage value", () => {
    const rows = projectedSchedule(terms, day("2026-01-31"), 1, 0, 2000);
    assert.ok(rows[rows.length - 1].accumulated <= 9000);
    assert.ok(rows[rows.length - 1].accumulated > 8990);
  });
});

describe("dates", () => {
  it("finds the last day of a month", () => {
    assert.equal(lastDayOfMonth(day("2026-02-10")).toISOString().slice(0, 10), "2026-02-28");
    assert.equal(lastDayOfMonth(day("2028-02-10")).toISOString().slice(0, 10), "2028-02-29");
    assert.equal(lastDayOfMonth(day("2026-12-01")).toISOString().slice(0, 10), "2026-12-31");
  });

  it("numbers months from the start of depreciation", () => {
    assert.equal(monthNumber(day("2026-03-01"), day("2026-03-31")), 1);
    assert.equal(monthNumber(day("2026-03-01"), day("2027-02-28")), 12);
    assert.ok(monthNumber(day("2026-03-01"), day("2026-02-28")) < 1);
  });
});

describe("checking the terms of an asset", () => {
  const ok = { name: "Van", cost: 1000, salvage: 0, method: "STRAIGHT_LINE" as const, lifeMonths: 60, annualRate: null, prior: 0 };

  it("accepts sensible terms", () => assert.equal(checkTerms(ok), null));
  it("needs a name", () => assert.ok(checkTerms({ ...ok, name: " " })));
  it("needs a positive cost", () => assert.ok(checkTerms({ ...ok, cost: 0 })));
  it("needs salvage below cost", () => assert.ok(checkTerms({ ...ok, salvage: 1000 })));
  it("needs a whole number of months for straight line", () => {
    assert.ok(checkTerms({ ...ok, lifeMonths: 0 }));
    assert.ok(checkTerms({ ...ok, lifeMonths: 12.5 }));
  });
  it("needs a rate for reducing balance", () => {
    assert.ok(checkTerms({ ...ok, method: "REDUCING_BALANCE", lifeMonths: null, annualRate: null }));
    assert.equal(checkTerms({ ...ok, method: "REDUCING_BALANCE", lifeMonths: null, annualRate: 20 }), null);
  });
  it("does not allow more prior depreciation than the cost less salvage", () => assert.ok(checkTerms({ ...ok, prior: 1500 })));
});
