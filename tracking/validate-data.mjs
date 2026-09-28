import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { validate, summarize } = require("./app.js");
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), "metrics.json");
try {
  const data = JSON.parse(readFileSync(source, "utf8"));
  const rows = validate(data);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(data.source?.retrievedAtUtc ?? "")) {
    throw new Error("Missing UTC source pull time");
  }
  if (data.source.dateTimezone !== "UTC" || !data.source.name || !data.source.exportType) {
    throw new Error("Missing source provenance");
  }
  for (const metric of ["downloads", "views"]) {
    const tally = summarize(rows, metric);
    console.log(`${metric}: ${tally.sum} numeric sum = ${data.metrics[metric].reportedTotal} reported total; ${tally.known}/${tally.days} numeric days`);
  }
  console.log(`PASS ${rows.length} contiguous UTC dates, ${data.period.start} through ${data.period.end}`);
} catch (error) {
  console.error("FAIL", error.message);
  process.exitCode = 1;
}
