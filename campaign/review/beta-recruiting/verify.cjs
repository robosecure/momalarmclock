const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const sourceDraft = '/Users/wamsley/Documents/Codex/2026-09-25/momalarm-capture-upgrade/tracking-private/launch-operations-2026-09-30/BETA_RECRUITING_DRAFT_2026-10-01.md';
const required = ['noindex,nofollow', 'REVIEW ONLY', 'NO POSTS SENT', 'Android Play install invitation held', 'Family Link limitation', 'beta-recruitment-copy-v1', 'MOMALARM_COPY_REVIEW_DECISION_V1', 'c6054f2a0e76822d99afd0b9385ca1ee6f6b9a5b9ce25b0b520a1ae7a253fb78', 'https://groups.google.com/g/momalarmclock-beta', 'https://play.google.com/apps/testing/com.momclock.momalarmclock', 'https://testflight.apple.com/join/j28Ec4ZB', 'Owned-page post', 'Platform cuts', 'Landing-page copy', 'Welcome and check-in emails', 'Support replies', 'Release gates'];

async function main() {
  const html = read('index.html');
  const js = read('review.js');
  if (!fs.readFileSync(path.join(root, 'draft.md')).equals(fs.readFileSync(sourceDraft))) throw new Error('draft.md does not byte-match the source draft');
  read('styles.css');
  for (const value of required) {
    if (!html.includes(value)) throw new Error(`Missing required content: ${value}`);
  }
  if (html.indexOf('https://groups.google.com/g/momalarmclock-beta') > html.indexOf('https://play.google.com/apps/testing/com.momclock.momalarmclock')) throw new Error('Android links are not group-first');
  new Function(js);
  const server = http.createServer((request, response) => {
    const file = request.url === '/review.js' ? 'review.js' : request.url === '/styles.css' ? 'styles.css' : request.url === '/draft.md' ? 'draft.md' : 'index.html';
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.md') ? 'text/markdown' : 'text/html');
    response.end(read(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    const draftText = fs.readFileSync(sourceDraft, 'utf8');
    if (await page.locator('#full-draft').textContent() !== draftText) throw new Error('Full source draft is not visible');
    await page.getByRole('button', { name: 'Approve exact copy' }).click();
    const approved = JSON.parse(await page.locator('#decision-packet').inputValue());
    if (approved.type !== 'MOMALARM_COPY_REVIEW_DECISION_V1' || approved.decision !== 'approve' || approved.item_id !== 'beta-recruitment-copy-v1' || !approved.public_review_url || !approved.draft_url) throw new Error('Approve packet is incomplete');
    await page.getByRole('button', { name: 'Request changes' }).click();
    if (!await page.locator('#feedback').isVisible() || await page.locator('#copy-packet').isEnabled() || await page.locator('#decision-packet').inputValue()) throw new Error('Request-changes state did not invalidate approval');
    await page.locator('#feedback').fill('too short');
    await page.getByRole('button', { name: 'Generate requested changes packet' }).click();
    if (await page.locator('#copy-packet').isEnabled() || await page.locator('#decision-packet').inputValue()) throw new Error('Invalid feedback generated a packet');
    await page.locator('#feedback').fill('Clarify the iPhone beta opening.');
    await page.getByRole('button', { name: 'Generate requested changes packet' }).click();
    const rejected = JSON.parse(await page.locator('#decision-packet').inputValue());
    if (rejected.type !== 'MOMALARM_COPY_REVIEW_DECISION_V1' || rejected.decision !== 'request_changes' || rejected.feedback !== 'Clarify the iPhone beta opening.') throw new Error('Reject packet is incomplete');
    await page.locator('#feedback').fill('Changed feedback after decision.');
    if (await page.locator('#copy-packet').isEnabled() || await page.locator('#decision-packet').inputValue()) throw new Error('Editing feedback did not invalidate packet');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
