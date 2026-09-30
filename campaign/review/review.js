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
  if (!item.asset || typeof item.asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.asset.sha256) || !ownedURL(item.asset.public_url) || !["video/mp4", "text/html", "image/png", "audio/mpeg"].includes(item.asset.mime)) throw new Error("Finished review asset is incomplete.");
  if (item.asset.mime === "audio/mpeg" && !/^https:\/\/robosecure\.github\.io\/momalarmclock\/campaign\/media\/[a-z0-9-]+\.mp3$/.test(item.asset.public_url)) throw new Error("Audio must be an exact owned MP3 URL.");
  if (Object.prototype.hasOwnProperty.call(item, "transcript") && (!["audio/mpeg", "video/mp4"].includes(item.asset.mime) || typeof item.transcript !== "string" || !item.transcript.trim() || item.transcript.length > 4000)) throw new Error("Media transcript must be bounded text.");
  const scope = item.action_scope;
  if (!scope || typeof scope.id !== "string" || !/^[a-z0-9_-]{1,80}$/.test(scope.id) || typeof scope.description !== "string" || !scope.description.trim() || scope.description.length > 600 || typeof scope.destination !== "string" || (scope.id === "organic_beta_static_v1" ? scope.destination !== ORGANIC_STATIC_DESTINATION : !ownedURL(scope.destination))) throw new Error("Exact action scope is missing.");
  if (item.status === "approved_via_review") approvalReceipt(item);
  if (item.status === "revision_required") {
    if (!["pending", "approved_via_chat", "approved_via_review"].includes(item.historical_status)) throw new Error("Revision history is incomplete.");
    if (item.revision_reason != null && (typeof item.revision_reason !== "string" || !item.revision_reason.trim() || item.revision_reason.length > 600)) throw new Error("Revision reason is invalid.");
    if (item.historical_status === "approved_via_review") approvalReceipt(item);
  }
  return item;
}
function decisionPacket(item, action, feedback = "") {
  validateItem(item);
  if (item.status !== "pending" || !["approve", "request_changes"].includes(action)) throw new Error("This item is read-only.");
  if (typeof feedback !== "string") throw new Error("Feedback must be text.");
  feedback = feedback.trim();
  if (feedback.length > 800) throw new Error("Please keep feedback within 800 characters.");
  if (action === "request_changes" && (feedback.length < 10 || feedback.split(/\s+/).length < 3)) throw new Error("Please describe the requested change in at least three words and ten characters.");
  return { schema: "momalarm-review-decision-v1", item_id: item.id, version: item.version, asset_sha256: item.asset.sha256, asset_url: item.asset.public_url, action_scope: item.action_scope, review_url: item.review_url, decision: action, feedback };
}
function chatDecisionText(item, action, feedback = "") {
  const packet = decisionPacket(item, action, feedback);
  return "Copy for the Mom Alarm marketing chat. This decision is not submitted or recorded until Rob pastes it into that chat. It applies only to the exact item, file, version and full action scope below. Root must verify the chat decision and exact packet before any scoped action.\n\nMOMALARM_REVIEW_DECISION_V1\n```json\n" + JSON.stringify(packet, null, 2) + "\n```";
}
function revisionFeedbackPacket(item, feedback = "") {
  validateItem(item);
  if (!["revision_required", "approved_via_chat", "approved_via_review"].includes(item.status) || !item.asset) throw new Error("This item cannot receive feedback on an exact historical file.");
  if (typeof feedback !== "string") throw new Error("Feedback must be text.");
  feedback = feedback.trim();
  if (feedback.length > 800) throw new Error("Please keep feedback within 800 characters.");
  if (feedback.length < 10 || feedback.split(/\s+/).length < 3) throw new Error("Please describe the requested change in at least three words and ten characters.");
  return { schema: "momalarm-revision-feedback-v1", item_id: item.id, version: item.version, asset_sha256: item.asset.sha256, asset_url: item.asset.public_url, review_url: item.review_url, feedback };
}
function revisionFeedbackText(item, feedback = "") {
  const packet = revisionFeedbackPacket(item, feedback);
  return "Copy feedback on this exact file for the Mom Alarm marketing chat. It is not submitted or recorded until Rob pastes it there. Feedback grants no approval or action authorization and does not automatically revoke or broaden an existing approval.\n\nMOMALARM_REVISION_FEEDBACK_V1\n```json\n" + JSON.stringify(packet, null, 2) + "\n```";
}
async function copyRevisionFeedback(item, feedback, clipboard, manual, localStatus) {
  const text = revisionFeedbackText(item, feedback);
  try {
    if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("Clipboard unavailable.");
    await clipboard.writeText(text);
    manual.hidden = true; manual.value = "";
    localStatus.textContent = "Copied feedback on this exact file. Rob must paste it into the Mom Alarm marketing chat; this click does not submit, approve, revoke or broaden an existing approval.";
    return true;
  } catch (_) {
    manual.value = text; manual.readOnly = true; manual.hidden = false; manual.focus(); manual.select();
    localStatus.textContent = "Clipboard unavailable. Select and copy the feedback below, then Rob must paste it into the Mom Alarm marketing chat. Nothing has been submitted, approved or authorized; existing approval is unchanged.";
    return false;
  }
}
async function copyChatDecision(item, action, feedback, clipboard, manual, localStatus) {
  const text = chatDecisionText(item, action, feedback);
  try {
    if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("Clipboard unavailable.");
    await clipboard.writeText(text);
    manual.hidden = true; manual.value = "";
    localStatus.textContent = "Copied. Paste the exact decision into the Mom Alarm marketing chat. It is not submitted or recorded by this click.";
    return true;
  } catch (_) {
    manual.value = text; manual.readOnly = true; manual.hidden = false; manual.focus(); manual.select();
    localStatus.textContent = "Clipboard unavailable. Select and copy the decision text below, then paste it into the Mom Alarm marketing chat. Nothing has been submitted.";
    return false;
  }
}
function decisionURL(item, action, feedback = "") {
  const packet = decisionPacket(item, action, feedback);
  const title = "[Mom Alarm review] " + (action === "approve" ? "APPROVE" : "REQUEST CHANGES") + " · " + item.id + " · " + item.version;
  const body = "Owner decision for this exact item. Submit while signed in as " + OWNER + ".\n\nOpening this draft is not a decision. This applies only to the recorded file/version/scope, not future assets or unrelated spend. Keep feedback public-safe.\n\nMOMALARM_REVIEW_DECISION_V1\n```json\n" + JSON.stringify(packet, null, 2) + "\n```\n\nRoot must verify the submitted issue author and exact packet before executing the scoped action. An agent-created request is not owner approval.";
  const url = new URL("https://github.com/" + REPO + "/issues/new"); url.searchParams.set("title", title); url.searchParams.set("body", body);
  if (url.href.length > 7500) throw new Error("Decision link is too long; shorten the feedback.");
  return url.href;
}
if (typeof module !== "undefined") module.exports = { validateItem, decisionURL, chatDecisionText, copyChatDecision, revisionFeedbackText, copyRevisionFeedback, ownedURL };
if (typeof document !== "undefined") {
  const status = document.getElementById("status");
  function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function card(item) {
    const e = element("article", undefined, "review"); e.id = item.id;
    const badges = { pending: "READY FOR OWNER REVIEW", approved_via_chat: "APPROVED VIA CHAT · READ-ONLY", approved_via_review: "APPROVED VIA REVIEW · READ-ONLY", revision_required: "REVISION REQUIRED · REFERENCE ONLY", awaiting_asset: "NOT READY FOR A DECISION" };
    e.append(element("p", badges[item.status], "badge"), element("h3", item.title), element("p", item.description));
    const link = element("a", "Direct link to this exact item"); link.href = item.review_url; e.append(link);
    if (item.status === "pending") { const jump = element("a", "Go to chat decision controls ↓", "decision-jump"); jump.href = "#actions-" + item.id; e.append(jump); }
    if (item.status === "approved_via_review") {
      const a = approvalReceipt(item);
      e.append(element("p", "Owner submitted approval: " + a.approved_at + ". Root verified the authenticated GitHub author, exact version, asset and complete action scope. This is a published receipt snapshot; approval is separate from execution.", "notice"));
      const receipt = element("a", "Open the submitted owner approval"); receipt.href = a.issue_url; e.append(receipt);
    }
    if (item.asset) {
      if (item.asset.mime === "video/mp4") { const video = element("video"); video.controls = true; video.playsInline = true; video.preload = "none"; video.src = item.asset.public_url; video.setAttribute("aria-label", item.title); e.append(video); }
      if (item.asset.mime === "image/png") { const image = element("img"); image.src = item.asset.public_url; image.alt = item.title; image.title = item.description; image.loading = "lazy"; image.decoding = "async"; e.append(image); }
      if (item.asset.mime === "audio/mpeg") { const audio = element("audio"); audio.controls = true; audio.preload = "none"; audio.src = item.asset.public_url; audio.setAttribute("aria-label", item.title); e.append(audio); }
      if (item.transcript !== undefined) { const script = element("details", undefined, "transcript"); script.append(element("summary", "Read the exact narration script")); for (const paragraph of item.transcript.split(/\n\s*\n/)) script.append(element("p", paragraph)); e.append(script); }
      const asset = element("a", "Open the finished review file"); asset.href = item.asset.public_url; e.append(asset);
      e.append(element("p", item.action_scope.description, "scope"));
      const details = element("details", undefined, "metadata"); details.append(element("summary", "Exact version and action"), element("p", "Version: " + item.version), element("p", "SHA256: " + item.asset.sha256), element("p", "Action: " + item.action_scope.id), element("p", "Destination: " + item.action_scope.destination)); e.append(details);
    }
    if (item.status === "pending") {
      const label = element("label", "Feedback for changes (required when rejecting)", "feedback-label"); label.htmlFor = "feedback-" + item.id;
      const feedback = element("textarea"); feedback.id = label.htmlFor; feedback.maxLength = 800; feedback.rows = 4; feedback.placeholder = "Describe what needs to change. No private tester details.";
      const actions = element("div", undefined, "actions"); actions.id = "actions-" + item.id;
      const localStatus = element("p", "Copy a decision, then paste it into the Mom Alarm marketing chat. Copying does not submit or record approval.", "notice"); localStatus.setAttribute("role", "status"); localStatus.setAttribute("aria-live", "polite");
      const manual = element("textarea"); manual.hidden = true; manual.readOnly = true; manual.rows = 12; manual.setAttribute("aria-label", "Decision text for manual copy"); manual.className = "manual-decision";
      for (const [action, text, className] of [["approve", "Copy approval for chat", "approve"], ["request_changes", "Copy requested changes for chat", "reject"]]) {
        const button = element("button", text, className); button.type = "button";
        button.addEventListener("click", async () => { try { await copyChatDecision(item, action, feedback.value, navigator.clipboard, manual, localStatus); } catch (error) { manual.hidden = true; manual.value = ""; localStatus.textContent = error.message; feedback.focus(); } }); actions.append(button);
      }
      const github = element("details", undefined, "github-option"); github.append(element("summary", "Optional: submit through GitHub instead"));
      const githubActions = element("div", undefined, "actions");
      for (const [action, text, className] of [["approve", "Open GitHub approval draft", "approve"], ["request_changes", "Open GitHub changes draft", "reject"]]) {
        const button = element("button", text, className); button.type = "button";
        button.addEventListener("click", () => { try { const url = decisionURL(item, action, feedback.value); window.open(url, "_blank", "noopener,noreferrer"); localStatus.textContent = "GitHub draft opened. Sign in as robosecure and select Submit new issue to record the decision. Nothing is saved by opening the draft."; } catch (error) { localStatus.textContent = error.message; feedback.focus(); } }); githubActions.append(button);
      }
      github.append(githubActions, element("p", "GitHub submission is optional. Opening a draft does not record a decision.", "notice"));
      e.append(label, feedback, actions, localStatus, manual, github);
    } else if (["revision_required", "approved_via_chat", "approved_via_review"].includes(item.status) && item.asset) {
      const label = element("label", "Feedback on this exact file", "feedback-label"); label.htmlFor = "revision-feedback-" + item.id;
      const feedback = element("textarea"); feedback.id = label.htmlFor; feedback.maxLength = 800; feedback.rows = 4; feedback.placeholder = "Describe the change you suggest. No private tester details.";
      const actions = element("div", undefined, "actions");
      const button = element("button", "Copy feedback for chat", "reject"); button.type = "button";
      const localStatus = element("p", "This exact file can receive feedback only. Rob must paste it into the Mom Alarm marketing chat. Feedback does not automatically revoke or broaden an existing approval and cannot authorize action.", "notice"); localStatus.setAttribute("role", "status"); localStatus.setAttribute("aria-live", "polite");
      const manual = element("textarea"); manual.hidden = true; manual.readOnly = true; manual.rows = 12; manual.setAttribute("aria-label", "Feedback text for manual copy"); manual.className = "manual-decision";
      button.addEventListener("click", async () => { try { await copyRevisionFeedback(item, feedback.value, navigator.clipboard, manual, localStatus); } catch (error) { manual.hidden = true; manual.value = ""; localStatus.textContent = error.message; feedback.focus(); } });
      actions.append(button); e.append(element("p", item.status === "revision_required" ? item.revision_reason || "Historical item needs a revised file and new exact review." : "Approval remains limited to this exact file and recorded scope; a changed file or placement needs fresh review.", "notice"), label, feedback, actions, localStatus, manual);
    } else e.append(element("p", item.status === "approved_via_review" ? "No duplicate decision requested. The approval covers only the displayed file, version and scope. Remaining runtime/listening gates still apply; no social posting, paid activation or future version is implied." : item.status === "approved_via_chat" ? "No duplicate approval requested. A new cut or placement needs its own exact review." : "The finished export, file hash and publication scope must be verified before approval controls appear.", "notice"));
    return e;
  }
  (async () => { try {
    const response = await fetch("items.json", { cache: "no-store" }); if (!response.ok) throw new Error("The review registry could not be loaded.");
    const registry = await response.json(); if (registry.schema !== "momalarm-review-registry-v1" || registry.repository !== REPO || registry.owner !== OWNER || !Array.isArray(registry.items)) throw new Error("Invalid review registry.");
    const ids = new Set(); for (const item of registry.items) { validateItem(item); if (ids.has(item.id)) throw new Error("Duplicate review item."); ids.add(item.id); }
    const pending = registry.items.filter(i => i.status === "pending");
    if (!pending.length) { const empty = element("div", undefined, "empty"); empty.append(element("p", "No pending owner decisions at this published checkpoint. Verified approvals and revision history are below. Approval does not mean the scoped action has executed; changed files or scopes need fresh review.")); document.getElementById("pending").append(empty); }
    for (const item of registry.items) document.getElementById(item.status === "pending" ? "pending" : item.status === "awaiting_asset" ? "waiting" : "history").append(card(item));
    status.textContent = pending.length ? pending.length + " item(s) ready for owner review. Copy a decision and paste it into the Mom Alarm marketing chat; this queue is not live receipt." : "No pending decisions at this checkpoint. Future exact decisions still need owner verification.";
    const historyTitle = document.getElementById("history-title"); if (historyTitle) historyTitle.textContent = "Approval receipts and revision history";
    const target = document.getElementById(location.hash.slice(1)); if (target) target.scrollIntoView();
  } catch (error) { status.textContent = error.message + " No approval controls have been enabled."; } })();
}
