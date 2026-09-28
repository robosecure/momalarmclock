"use strict";
const REPO = "robosecure/momalarmclock";
const OWNER = "robosecure";
const SITE = "https://robosecure.github.io/momalarmclock/";
const REVIEW = SITE + "campaign/review/";
const ORGANIC_STATIC_DESTINATION = "https://www.facebook.com/momalarmclock/ | https://www.instagram.com/momalarmclock/ | https://www.youtube.com/@momalarmclock | https://www.tiktok.com/@momalarmclock | https://x.com/momalarmclock";
function ownedURL(value) { if (typeof value !== "string") return false; try { const url = new URL(value); return url.href.startsWith(SITE) && url.origin === new URL(SITE).origin && !url.username && !url.password; } catch (_) { return false; } }
function approvalReceipt(item) {
  const a = item.approval;
  const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace("Z", ".000Z");
  if (!a || a.source !== "authenticated_owner_github_issue" || a.owner !== OWNER || typeof a.issue_url !== "string" || !/^https:\/\/github\.com\/robosecure\/momalarmclock\/issues\/[1-9][0-9]*$/.test(a.issue_url) || !timestamp(a.approved_at) || typeof a.verified_at !== "string" || !Number.isFinite(Date.parse(a.verified_at)) || a.item_id !== item.id || a.version !== item.version || a.asset_sha256 !== item.asset.sha256 || typeof a.scope_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(a.scope_sha256)) throw new Error("Verified approval receipt is incomplete.");
  return a;
}
function validateItem(item) {
  if (!item || typeof item.id !== "string" || typeof item.version !== "string" || !/^[a-z0-9-]{1,80}$/.test(item.id) || !/^[A-Za-z0-9_-]{1,60}$/.test(item.version) || typeof item.title !== "string" || typeof item.description !== "string") throw new Error("Invalid review item.");
  if (!["pending", "approved_via_chat", "approved_via_review", "revision_required", "awaiting_asset"].includes(item.status) || item.review_url !== REVIEW + "#" + item.id) throw new Error("Invalid review status or URL.");
  if (item.status === "awaiting_asset") { if (item.asset !== null || item.action_scope !== null) throw new Error("Unfinished items cannot request approval."); return item; }
  if (!item.asset || typeof item.asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.asset.sha256) || !ownedURL(item.asset.public_url) || !["video/mp4", "text/html", "image/png"].includes(item.asset.mime)) throw new Error("Finished review asset is incomplete.");
  const scope = item.action_scope;
  if (!scope || typeof scope.id !== "string" || !/^[a-z0-9_-]{1,80}$/.test(scope.id) || typeof scope.description !== "string" || !scope.description.trim() || scope.description.length > 600 || typeof scope.destination !== "string" || (scope.id === "organic_beta_static_v1" ? scope.destination !== ORGANIC_STATIC_DESTINATION : !ownedURL(scope.destination))) throw new Error("Exact action scope is missing.");
  if (item.status === "approved_via_review") approvalReceipt(item);
  if (item.status === "revision_required" && item.historical_status !== "approved_via_chat") throw new Error("Revision history is incomplete.");
  return item;
}
function decisionURL(item, action, feedback = "") {
  validateItem(item);
  if (item.status !== "pending" || !["approve", "request_changes"].includes(action)) throw new Error("This item is read-only.");
  if (typeof feedback !== "string") throw new Error("Feedback must be text.");
  feedback = feedback.trim();
  if (feedback.length > 800) throw new Error("Please keep feedback within 800 characters.");
  if (action === "request_changes" && (feedback.length < 10 || feedback.split(/\s+/).length < 3)) throw new Error("Please describe the requested change in at least three words and ten characters.");
  const packet = { schema: "momalarm-review-decision-v1", item_id: item.id, version: item.version, asset_sha256: item.asset.sha256, asset_url: item.asset.public_url, action_scope: item.action_scope, review_url: item.review_url, decision: action, feedback };
  const title = "[Mom Alarm review] " + (action === "approve" ? "APPROVE" : "REQUEST CHANGES") + " · " + item.id + " · " + item.version;
  const body = "Owner decision for this exact item. Submit while signed in as " + OWNER + ".\n\nOpening this draft is not a decision. This applies only to the recorded file/version/scope, not future assets or unrelated spend. Keep feedback public-safe.\n\nMOMALARM_REVIEW_DECISION_V1\n```json\n" + JSON.stringify(packet, null, 2) + "\n```\n\nRoot must verify the submitted issue author and exact packet before executing the scoped action. An agent-created request is not owner approval.";
  const url = new URL("https://github.com/" + REPO + "/issues/new"); url.searchParams.set("title", title); url.searchParams.set("body", body);
  if (url.href.length > 7500) throw new Error("Decision link is too long; shorten the feedback.");
  return url.href;
}
if (typeof module !== "undefined") module.exports = { validateItem, decisionURL, ownedURL };
if (typeof document !== "undefined") {
  const status = document.getElementById("status");
  function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function card(item) {
    const e = element("article", undefined, "review"); e.id = item.id;
    const badges = { pending: "READY FOR OWNER REVIEW", approved_via_chat: "APPROVED VIA CHAT · READ-ONLY", approved_via_review: "APPROVED VIA REVIEW · READ-ONLY", revision_required: "REVISION REQUIRED · REFERENCE ONLY", awaiting_asset: "NOT READY FOR A DECISION" };
    e.append(element("p", badges[item.status], "badge"), element("h3", item.title), element("p", item.description));
    const link = element("a", "Direct link to this exact item"); link.href = item.review_url; e.append(link);
    if (item.status === "approved_via_review") {
      const a = approvalReceipt(item);
      e.append(element("p", "Owner submitted approval: " + a.approved_at + ". Root verified the authenticated GitHub author, exact version, asset and complete action scope. This is a published receipt snapshot; approval is separate from execution.", "notice"));
      const receipt = element("a", "Open the submitted owner approval"); receipt.href = a.issue_url; e.append(receipt);
    }
    if (item.asset) {
      if (item.asset.mime === "video/mp4") { const video = element("video"); video.controls = true; video.playsInline = true; video.preload = "none"; video.src = item.asset.public_url; video.setAttribute("aria-label", item.title); e.append(video); }
      if (item.asset.mime === "image/png") { const image = element("img"); image.src = item.asset.public_url; image.alt = item.title; image.title = item.description; image.loading = "lazy"; image.decoding = "async"; e.append(image); }
      const asset = element("a", "Open the finished review file"); asset.href = item.asset.public_url; e.append(asset);
      e.append(element("p", item.action_scope.description, "scope"));
      const details = element("details", undefined, "metadata"); details.append(element("summary", "Exact version and action"), element("p", "Version: " + item.version), element("p", "SHA256: " + item.asset.sha256), element("p", "Action: " + item.action_scope.id), element("p", "Destination: " + item.action_scope.destination)); e.append(details);
    }
    if (item.status === "pending") {
      const label = element("label", "Feedback for changes (required when rejecting)", "feedback-label"); label.htmlFor = "feedback-" + item.id;
      const feedback = element("textarea"); feedback.id = label.htmlFor; feedback.maxLength = 800; feedback.rows = 4; feedback.placeholder = "Describe what needs to change. No private tester details.";
      const actions = element("div", undefined, "actions");
      for (const [action, text, className] of [["approve", "Approve", "approve"], ["request_changes", "Reject / request changes", "reject"]]) {
        const button = element("button", text, className); button.type = "button";
        button.addEventListener("click", () => { try { const url = decisionURL(item, action, feedback.value); window.open(url, "_blank", "noopener,noreferrer"); status.textContent = "GitHub draft opened. Sign in as robosecure and select Submit new issue to record the decision. Nothing is saved by opening the draft."; } catch (error) { status.textContent = error.message; feedback.focus(); } }); actions.append(button);
      }
      e.append(label, feedback, actions, element("p", "Both buttons open GitHub. Final GitHub submission records your signed-in decision; it does not instantly publish the item.", "notice"));
    } else e.append(element("p", item.status === "revision_required" ? "Historical chat approval for gallery hosting is retained. This earlier ad is not approved for the current campaign: every launch ad must include both alarms AND reminders. A revised file and scope need fresh exact review." : item.status === "approved_via_review" ? "No duplicate decision requested. The approval covers only the displayed file, version and scope. Remaining runtime/listening gates still apply; no social posting, paid activation or future version is implied." : item.status === "approved_via_chat" ? "No duplicate approval requested. A new cut or placement needs its own exact review." : "The finished export, file hash and publication scope must be verified before approval controls appear.", "notice"));
    return e;
  }
  (async () => { try {
    const response = await fetch("items.json", { cache: "no-store" }); if (!response.ok) throw new Error("The review registry could not be loaded.");
    const registry = await response.json(); if (registry.schema !== "momalarm-review-registry-v1" || registry.repository !== REPO || registry.owner !== OWNER || !Array.isArray(registry.items)) throw new Error("Invalid review registry.");
    const ids = new Set(); for (const item of registry.items) { validateItem(item); if (ids.has(item.id)) throw new Error("Duplicate review item."); ids.add(item.id); }
    const pending = registry.items.filter(i => i.status === "pending");
    if (!pending.length) { const empty = element("div", undefined, "empty"); empty.append(element("p", "No pending owner decisions at this published checkpoint. Verified approvals and revision history are below. Approval does not mean the scoped action has executed; changed files or scopes need fresh review.")); document.getElementById("pending").append(empty); }
    for (const item of registry.items) document.getElementById(item.status === "pending" ? "pending" : item.status === "awaiting_asset" ? "waiting" : "history").append(card(item));
    status.textContent = pending.length ? pending.length + " item(s) ready for owner review. This queue is a published checkpoint, not live decision receipt." : "No pending decisions at this checkpoint. GitHub submission and owner verification remain required for future items.";
    const historyTitle = document.getElementById("history-title"); if (historyTitle) historyTitle.textContent = "Approval receipts and revision history";
    const target = document.getElementById(location.hash.slice(1)); if (target) target.scrollIntoView();
  } catch (error) { status.textContent = error.message + " No approval controls have been enabled."; } })();
}
