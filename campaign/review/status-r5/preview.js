(() => {
  'use strict';

  const candidates = [
    {
      frameId: 'campaign-preview', stateId: 'campaign-state', rawFile: 'campaign-candidate.html',
      sha256: 'a348cdec103ef04e337b6744cca9ca143072f6f430c2c59c8703667b557ed9af',
      publicBase: 'https://robosecure.github.io/momalarmclock/campaign/'
    },
    {
      frameId: 'tracking-preview', stateId: 'tracking-state', rawFile: 'tracking-candidate.html',
      sha256: '7086868a870e5ff15b14a4dd44187878c5446aa66f7fdb94481102e75c4a3ba6',
      publicBase: 'https://robosecure.github.io/momalarmclock/tracking/'
    }
  ];

  const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const withBase = (html, base) => html.replace(/<head\b[^>]*>/i, head => `${head}<base href="${base}">`);

  async function loadOne(candidate) {
    const frame = document.getElementById(candidate.frameId);
    const state = document.getElementById(candidate.stateId);
    frame.setAttribute('sandbox', '');
    frame.removeAttribute('srcdoc');
    state.textContent = 'Verifying exact candidate bytes…';
    try {
      const response = await fetch(candidate.rawFile, { cache: 'no-store' });
      if (!response.ok) throw new Error(`fetch failed (${response.status})`);
      const bytes = await response.arrayBuffer();
      const actual = hex(await crypto.subtle.digest('SHA-256', bytes));
      if (actual !== candidate.sha256) throw new Error('checksum mismatch');
      const html = new TextDecoder().decode(bytes);
      const preview = withBase(html, candidate.publicBase);
      if (preview === html) throw new Error('candidate has no head element');
      frame.srcdoc = preview;
      state.textContent = `Verified SHA-256 ${actual}. Read-only preview loaded.`;
    } catch (error) {
      frame.removeAttribute('srcdoc');
      const reason = error && error.message === 'checksum mismatch' ? 'checksum did not match' : 'could not be loaded';
      state.textContent = `Preview ${reason}; nothing was rendered. Use the raw candidate link to inspect the file.`;
    }
  }

  async function loadAll() { await Promise.all(candidates.map(loadOne)); }
  window.StatusR5Preview = { loadAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAll, { once: true });
  else loadAll();
})();
