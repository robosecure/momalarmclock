import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const model = require("./app.js");
const data = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "metrics.json"), "utf8"));
const rows = model.validate(data);

test("source totals, coverage, and original unknown display reconcile", () => {
  assert.deepEqual(model.summarize(rows, "downloads"), { sum: 229, known: 75, days: 90 });
  assert.deepEqual(model.summarize(rows, "views"), { sum: 689, known: 87, days: 90 });
  assert.equal(rows.filter(row => row.downloads === null).length, 15);
  assert.equal(rows.filter(row => row.views === null).length, 3);
  assert.ok(rows.every(row => row.downloads !== 0 || row.downloadsDisplay === "0"));
  assert.ok(rows.filter(row => row.downloads === null).every(row => row.downloadsDisplay === "-"));
  const bad = structuredClone(data);
  bad.metrics.downloads.reportedTotal++;
  assert.throws(() => model.validate(bad), /reconciliation/);
});

test("UTC windows are inclusive, leap safe, and current history is separate", () => {
  assert.equal(model.dayNumber("2026-09-27") - model.dayNumber("2026-09-21"), 6);
  assert.equal(model.dateAt(model.dayNumber("2028-02-28") + 1), "2028-02-29");
  assert.throws(() => model.dayNumber("2026-02-30"), /Invalid UTC date/);
  assert.equal(model.windowRows(rows, "2026-09-21", "2026-09-27").length, 7);
  assert.equal(model.windowRows(rows, "2026-06-29", "2026-06-29").length, 0);
  assert.equal(data.period.start, "2026-06-30");
});

test("equal-length comparisons require fully observed periods", () => {
  assert.deepEqual(model.compare(rows, "downloads", "2026-09-21", "2026-09-27"), {
    current: 14, previous: 25, difference: -11, change: -0.44,
    priorStart: "2026-09-14", priorEnd: "2026-09-20"
  });
  assert.equal(model.compare(rows, "downloads", "2026-08-29", "2026-09-27"), null);
  assert.equal(model.compare(rows, "downloads", "2026-06-30", "2026-09-27"), null);
  assert.equal(model.compare(rows, "views", "2026-09-21", "2026-09-27")?.previous, 38);
  assert.equal(model.compare(rows, "views", "2026-08-29", "2026-09-27")?.previous, 305);
});

test("null, zero, and unattributable denominators stay distinct", () => {
  assert.equal(model.ratio(7, 0), null);
  assert.equal(model.ratio(7, null), null);
  assert.equal(model.ratio(null, 7), null);
  assert.equal(model.ratio(0, 7), 0);
  const example = [{ date: "2026-01-01", downloads: null }, { date: "2026-01-02", downloads: 0 }];
  assert.deepEqual(model.summarize(example, "downloads"), { sum: 0, known: 1, days: 2 });
});

test("CSV matches selection, leaves unknown blank, and escapes text", () => {
  assert.equal(model.csvCell('a,"b"\n'), '"a,""b""\n"');
  const selected = model.windowRows(rows, "2026-06-30", "2026-07-02");
  const csv = model.selectedCsv(selected, "downloads");
  assert.equal(csv.trimEnd().split("\r\n").length, 4);
  assert.match(csv, /2026-07-01,,-/);
  assert.doesNotMatch(csv, /2026-09-27/);
});
