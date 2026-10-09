import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui = readFileSync(new URL('../src/rooms-ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/rooms.css', import.meta.url), 'utf8');

test('owner-only room configuration uses masked non-login inputs on Chromium', () => {
  const ownerUi = ui.slice(ui.indexOf('export async function mountDashboard('));
  for (const id of ['create-provider-pass', 'create-relay-secret', 'settings-provider-pass', 'settings-relay-secret']) {
    const input = ownerUi.match(new RegExp('<input id="' + id + '"[^>]*>'));
    assert(input, 'Expected ' + id);
    assert.match(input[0], /type="text"/);
    assert.match(input[0], /data-private-input/);
    assert.match(input[0], /autocomplete="off"/);
    assert.match(input[0], /data-lpignore="true"/);
    assert.doesNotMatch(input[0], /autocomplete="new-password"/);
  }
  assert.equal((ownerUi.match(/type="password"/g) || []).length, 0,
    'Room-owner forms must not be mistaken for password logins');
  assert.match(css, /\.room-secret-input\s*\{[^}]*-webkit-text-security:\s*disc/s);
  assert.match(ui, /CSS\.supports\('-webkit-text-security', 'disc'\)/);
  assert.match(ui, /field\.type = 'password'/);
  assert.match(ownerUi, /<form id="create-room"[^>]*autocomplete="off"/);
  assert.match(ownerUi, /<form id="settings-form"[^>]*autocomplete="off"/);
});

test('actual guest authentication retains a native password input', () => {
  const actualAuth = ui.slice(0, ui.indexOf('export async function mountDashboard('));
  assert.match(actualAuth, /type="password" required maxlength="128" autocomplete="current-password"/);
});

test('an Xtream account is optional when creating a private relay room', () => {
  const ownerUi = ui.slice(ui.indexOf('export async function mountDashboard('));
  for (const id of ['create-provider-origin', 'create-provider-user', 'create-provider-pass']) {
    const input = ownerUi.match(new RegExp('<input id="' + id + '"[^>]*>'));
    assert(input);
    assert(!input[0].includes(' required'), 'Xtream provider must be optional');
  }
  assert.match(ownerUi, /const hasProvider = Object\.values\(provider\)\.some\(Boolean\)/);
  assert.match(ownerUi, /\.\.\.\(hasProvider \? \{ provider \} : \{\}\)/);
  assert.match(ownerUi, /if \(event\.currentTarget\.dataset\.relayVerified !== 'true'\)/);
  assert.match(ownerUi, /querySelectorAll\('\.provider-fields:not\(\.relay-fields\) input'\)/);
});
