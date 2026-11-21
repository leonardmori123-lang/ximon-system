// The home-screen menu (public/js/app.js): every link must open a real page that lets that role in.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Reads the ROLE_SCREENS table out of app.js without running the page code.
function readMenu() {
  const source = fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8');
  const start = source.indexOf('const ROLE_SCREENS = {');
  const end = source.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'ROLE_SCREENS was not found in app.js');
  return new Function(`${source.slice(start, end + 3)}\nreturn ROLE_SCREENS;`)();
}

// The roles a page lets in: null when it lets everybody in, otherwise the list in its startPage([...]) call.
function rolesAllowedBy(page) {
  const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((src) => src.startsWith('/js/') && src !== '/js/common.js'); // our own page scripts only
  const calls = [];
  for (const src of scripts) {
    const code = fs.readFileSync(path.join(PUBLIC, src), 'utf8');
    for (const m of code.matchAll(/startPage\(([^)]*)\)/g)) calls.push(m[1].trim());
  }
  assert.strictEqual(calls.length, 1, `${page} should call startPage once, found ${calls.length}`);
  return calls[0] === '' ? null : [...calls[0].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}

test('every menu link opens a page that exists and lets that role in', () => {
  const menu = readMenu();
  assert.deepStrictEqual(Object.keys(menu).sort(), ['custodian', 'foreman', 'owner', 'purchaser', 'verifier']);
  let checked = 0;
  for (const [role, screens] of Object.entries(menu)) {
    for (const screen of screens) {
      if (screen.href === null) continue; // not built yet
      const page = screen.href.replace(/^\//, '').split('?')[0];
      assert.ok(fs.existsSync(path.join(PUBLIC, page)), `${role}: "${screen.label}" points to ${screen.href}, which does not exist`);
      const allowed = rolesAllowedBy(page);
      assert.ok(allowed === null || allowed.includes(role), `${role}: "${screen.label}" opens ${screen.href}, but that page does not let ${role} in`);
      checked++;
    }
  }
  assert.ok(checked >= 14, `only ${checked} links were checked`);
});

test('the purchasing menu links: owner and purchaser reach the PR and PO pages, the verifier reaches the POs', () => {
  const menu = readMenu();
  const hrefs = (role) => menu[role].filter((s) => s.href).map((s) => s.href);
  assert.ok(hrefs('owner').includes('/prs.html'));
  assert.ok(hrefs('owner').includes('/pos.html'));
  assert.deepStrictEqual(hrefs('purchaser').filter((h) => /^\/(suppliers|prs|pos)\.html$/.test(h)), ['/suppliers.html', '/prs.html', '/pos.html']);
  assert.ok(hrefs('verifier').includes('/pos.html'));
  assert.ok(!hrefs('foreman').includes('/pos.html') && !hrefs('custodian').includes('/pos.html'));
});
