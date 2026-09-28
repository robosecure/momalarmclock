(function (global) {
  "use strict";
  const DAY = 86400000;
  const labels = { downloads: "First-time downloads", views: "Product page views" };
  const iso = date => new Date(date).toISOString().slice(0, 10);
  function dayNumber(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid UTC date");
    const timestamp = Date.parse(date + "T00:00:00Z");
    if (!Number.isFinite(timestamp) || iso(timestamp) !== date) throw new Error("Invalid UTC date");
    return timestamp / DAY;
  }
  const dateAt = day => iso(day * DAY);
  const ratio = (numerator, denominator) =>
    Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator : null;
  function windowRows(rows, start, end) {
    const a = dayNumber(start), b = dayNumber(end);
    if (a > b) throw new Error("Start date follows end date");
    return rows.filter(row => {
      const day = dayNumber(row.date);
      return day >= a && day <= b;
    });
  }
  function summarize(rows, metric) {
    if (!labels[metric]) throw new Error("Unknown metric");
    const known = rows.filter(row => row[metric] !== null);
    return { sum: known.reduce((sum, row) => sum + row[metric], 0), known: known.length, days: rows.length };
  }
  function compare(rows, metric, start, end) {
    const days = dayNumber(end) - dayNumber(start) + 1;
    const current = windowRows(rows, start, end);
    const priorEnd = dateAt(dayNumber(start) - 1);
    const priorStart = dateAt(dayNumber(start) - days);
    const previous = windowRows(rows, priorStart, priorEnd);
    if (current.length !== days || previous.length !== days) return null;
    const a = summarize(current, metric), b = summarize(previous, metric);
    if (a.known !== days || b.known !== days || b.sum === 0) return null;
    return { current: a.sum, previous: b.sum, difference: a.sum - b.sum, change: ratio(a.sum - b.sum, b.sum), priorStart, priorEnd };
  }
  function csvCell(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function selectedCsv(rows, metric) {
    return ["date_utc," + csvCell(labels[metric]) + ",asc_display_value", ...rows.map(row =>
      [row.date, row[metric], row[metric + "Display"]].map(csvCell).join(",")
    )].join("\r\n") + "\r\n";
  }
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.days) || !data.metrics) throw new Error("Invalid data schema");
    if (!data.period || !data.period.start || !data.period.end ||
        data.days.length !== dayNumber(data.period.end) - dayNumber(data.period.start) + 1) {
      throw new Error("Unexpected source window");
    }
    const ordered = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < ordered.length; i++) {
      if (dayNumber(ordered[i].date) !== dayNumber(data.period.start) + i) throw new Error("Missing or duplicate UTC date");
      for (const metric of Object.keys(labels)) {
        const value = ordered[i][metric], display = ordered[i][metric + "Display"];
        if (value === null) {
          if (display !== "-") throw new Error("Unknown value lacks original display");
        } else if (!Number.isInteger(value) || value < 0 || String(value) !== display) {
          throw new Error("Invalid reported daily value");
        }
      }
    }
    for (const metric of Object.keys(labels)) {
      const summary = summarize(ordered, metric), source = data.metrics[metric];
      if (!source || summary.sum !== source.numericSum || summary.known !== source.knownDays ||
          source.reportedTotal !== summary.sum || source.totalDays !== ordered.length) {
        throw new Error("Source total reconciliation failed for " + metric);
      }
    }
    return ordered;
  }
  const model = { dayNumber, dateAt, ratio, windowRows, summarize, compare, csvCell, selectedCsv, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (!global.document) return;

  const doc = global.document;
  const byId = id => doc.getElementById(id);
  const dateFields = [byId("start-date"), byId("end-date")];
  function clearDateError() {
    for (const field of dateFields) {
      field.setCustomValidity("");
      field.removeAttribute("aria-invalid");
    }
  }
  const svgNS = "http://www.w3.org/2000/svg";
  let data, rows, selection = { metric: "downloads", start: "2026-06-30", end: "2026-09-27" };
  const number = value => new Intl.NumberFormat("en-US").format(value);
  const dateLabel = date => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
  const svgElement = (name, attributes) => {
    const element = doc.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  function drawChart(selected, metric) {
    const host = byId("chart");
    host.replaceChildren();
    const width = 740, height = 250, left = 42, right = 12, top = 14, bottom = 34;
    const plotW = width - left - right, plotH = height - top - bottom;
    const max = Math.max(1, ...selected.map(row => row[metric] ?? 0));
    const chart = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
    const x = i => left + (selected.length === 1 ? plotW / 2 : (i / (selected.length - 1)) * plotW);
    const y = value => top + plotH - value / max * plotH;
    for (let tick = 0; tick <= 2; tick++) {
      const value = Math.round(max * tick / 2), lineY = y(value);
      chart.append(svgElement("line", { x1: left, y1: lineY, x2: width - right, y2: lineY, class: "grid" }));
      const label = svgElement("text", { x: left - 8, y: lineY + 4, "text-anchor": "end" });
      label.textContent = value;
      chart.append(label);
    }
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      if (segment.length === 1) chart.append(svgElement("circle", { cx: segment[0][0], cy: segment[0][1], r: 3.5, class: "point" }));
      else chart.append(svgElement("polyline", { points: segment.map(point => point.join(",")).join(" "), class: "series" }));
      segment = [];
    };
    selected.forEach((row, i) => {
      if (row[metric] === null) {
        flush();
        chart.append(svgElement("line", { x1: x(i) - 3, y1: top + plotH + 5, x2: x(i) + 3, y2: top + plotH + 5, class: "missing" }));
      } else segment.push([x(i), y(row[metric])]);
    });
    flush();
    const first = svgElement("text", { x: left, y: height - 8 }); first.textContent = dateLabel(selected[0].date);
    const last = svgElement("text", { x: width - right, y: height - 8, "text-anchor": "end" }); last.textContent = dateLabel(selected[selected.length - 1].date);
    chart.append(first, last);
    host.append(chart);
    host.setAttribute("aria-label", `${labels[metric]} from ${selection.start} to ${selection.end} UTC. ${summarize(selected, metric).known} of ${selected.length} days have numeric values. Exact values are in the table below.`);
  }
  function render() {
    const { metric, start, end } = selection;
    const selected = windowRows(rows, start, end);
    if (!selected.length || selected.length !== dayNumber(end) - dayNumber(start) + 1) throw new Error("Selected dates outside source");
    const summary = summarize(selected, metric);
    const fullSource = start === data.period.start && end === data.period.end;
    byId("metric-name").textContent = labels[metric];
    byId("metric-total").textContent = number(fullSource ? data.metrics[metric].reportedTotal : summary.sum);
    byId("metric-context").textContent = `${fullSource ? "Apple reported total" : "Sum of observed days"} · ${summary.known}/${summary.days} days numeric${summary.known < summary.days ? " · incomplete daily coverage" : ""}`;
    const comparison = compare(rows, metric, start, end);
    byId("comparison").textContent = comparison
      ? `Previous ${summary.days} days: ${number(comparison.previous)} · ${comparison.difference >= 0 ? "+" : "−"}${number(Math.abs(comparison.difference))} (${comparison.change >= 0 ? "+" : "−"}${Math.abs(comparison.change * 100).toFixed(1)}%)`
      : "Previous equal period: not comparable (missing date, unknown day, or zero baseline)";
    byId("chart-range").textContent = `${start}–${end} · UTC`;
    byId("table-caption").textContent = `${labels[metric]} · ${start} to ${end} UTC · ${summary.known} of ${summary.days} days numeric. Empty numeric cells mean unknown, including Apple's “-” display.`;
    byId("table-metric-heading").textContent = labels[metric];
    const body = byId("daily-body");
    body.replaceChildren();
    for (const row of selected) {
      const tr = doc.createElement("tr");
      for (const value of [row.date, row[metric] === null ? "" : String(row[metric]), row[metric + "Display"]]) {
        const td = doc.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
    drawChart(selected, metric);
    byId("start-date").value = start; byId("end-date").value = end;
    clearDateError();
    for (const button of doc.querySelectorAll("[data-range]")) {
      const rangeStart = dateAt(dayNumber(data.period.end) - Number(button.dataset.range) + 1);
      button.setAttribute("aria-pressed", String(start === rangeStart && end === data.period.end));
    }
  }
  function download() {
    const content = selectedCsv(windowRows(rows, selection.start, selection.end), selection.metric);
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = doc.createElement("a");
    link.href = url;
    link.download = `momalarm-${selection.metric}-${selection.start}-${selection.end}.csv`;
    doc.body.append(link); link.click(); link.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function initialize() {
    try {
      const response = await fetch("./metrics.json", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      data = await response.json();
      rows = validate(data);
      byId("load-state").hidden = true;
      const lagDays = Math.floor((Date.now() - Date.parse(data.period.end + "T00:00:00Z")) / DAY);
      byId("freshness").textContent = `Daily data through ${data.period.end} UTC · ${lagDays > 3 ? "Stale snapshot; verify the source before decisions." : "recent days may be revised by Apple."}`;
      for (const id of ["start-date", "end-date"]) {
        byId(id).min = data.period.start;
        byId(id).max = data.period.end;
      }
      selection.start = dateAt(Math.max(dayNumber(data.period.start), dayNumber(data.period.end) - 89));
      selection.end = data.period.end;
      render();
    } catch (_) {
      byId("load-state").textContent = "Interactive daily snapshot unavailable or failed validation. Chart, table, and CSV cannot be shown. Other figures below are a dated Sep 28 source note and may be stale. Refresh the page or check the published data file.";
      byId("load-state").classList.add("error");
    }
  }
  doc.querySelectorAll("[data-range]").forEach(button => button.addEventListener("click", () => {
    if (!rows) return;
    const days = Number(button.dataset.range);
    selection.start = dateAt(dayNumber(data.period.end) - days + 1);
    selection.end = data.period.end;
    selection.metric = byId("metric").value;
    render();
  }));
  byId("metric").addEventListener("change", event => {
    if (!rows) return;
    selection.metric = event.target.value;
    render();
  });
  byId("metric-controls").addEventListener("submit", event => {
    event.preventDefault();
    if (!rows) return;
    const start = byId("start-date").value, end = byId("end-date").value;
    try {
      if (dayNumber(start) < dayNumber(data.period.start) || dayNumber(end) > dayNumber(data.period.end) || dayNumber(start) > dayNumber(end)) throw new Error("Outside source");
      selection.start = start; selection.end = end; selection.metric = byId("metric").value;
      clearDateError();
      render();
    } catch (_) {
      byId("end-date").setCustomValidity("Choose dates within the available source window, in order.");
      byId("end-date").setAttribute("aria-invalid", "true");
      byId("end-date").reportValidity();
    }
  });
  for (const field of dateFields) {
    field.addEventListener("input", clearDateError);
    field.addEventListener("change", clearDateError);
  }
  byId("download-csv").addEventListener("click", () => { if (rows) download(); });
  initialize();
})(typeof window !== "undefined" ? window : globalThis);
