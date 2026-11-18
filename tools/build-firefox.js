'use strict';
/*
 * Builds the Firefox copy of the extension from the Chrome source.
 *
 *   node tools/build-firefox.js
 *
 * The source stays in one place: this script copies the extension files to
 * ../PoeTradeFirefox and writes the manifest Firefox needs (sidebar instead of
 * side panel, event page instead of a service worker, optional host permissions
 * in the key Firefox understands). Nothing here is Chrome-specific code, so a
 * fix made for one browser reaches the other on the next build.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const OUT = path.resolve(SRC, '..', 'PoeTradeFirefox');
const GECKO_ID = 'poe-trade-watcher@iulicafarafrica.github.io';

/* Everything the Chrome package ships, minus the offscreen document (Firefox
   has no such API and the tone is played by the sidebar or a trade tab), plus
   the page-side tone both browsers now load. */
const FILES = [
  'ascendancies.js',
  'background.js',
  'coe.js',
  'content.css',
  'content.js',
  'item-utils.js',
  'pako.min.js',
  'pob-import.js',
  'privacy.css',
  'privacy.html',
  'privacy.js',
  'ptc-features.js',
  'ptc-games.js',
  'ptc-modtext.js',
  'ptc-poe1.js',
  'ptc-poe2.js',
  'ptc-settings.js',
  'ptc-sound.js',
  'sidepanel.css',
  'sidepanel.html',
  'sidepanel.js',
  'themes.css',
  'viewer.css',
  'viewer.html',
  'viewer.js',
];
const DIRS = ['fonts', 'icons'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((entry) => {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  });
}

function firefoxManifest(chrome) {
  const permissions = chrome.permissions.filter((name) => name !== 'sidePanel' && name !== 'offscreen');
  const content = chrome.content_scripts.map((entry) => {
    /* The tone has to be loaded before content.js so it is ready when the
       first row is enhanced. */
    const js = entry.js.filter((file) => file !== 'ptc-sound.js');
    const at = js.indexOf('content.js');
    if (at === -1) js.push('ptc-sound.js');
    else js.splice(at, 0, 'ptc-sound.js');
    return Object.assign({}, entry, { js: js });
  });

  const manifest = {
    manifest_version: 3,
    name: chrome.name,
    description: chrome.description,
    version: chrome.version,
    author: chrome.author,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '142.0',
        /* Nothing is collected: there is no analytics and no server of ours.
           Alerts only carry what the user asked to send to their own webhook. */
        data_collection_permissions: { required: ['none'] },
      },
    },
    permissions: permissions,
    host_permissions: chrome.host_permissions,
    /* Firefox does not know optional_host_permissions; the same patterns go in
       optional_permissions, which Firefox grants per origin on request. */
    optional_permissions: chrome.optional_host_permissions,
    /* Chrome runs background.js as a service worker that pulls its helpers in
       with importScripts(). A Firefox background page has no importScripts, so
       the same files are listed here, in the same order, and load first. */
    background: {
      scripts: [
        'ptc-games.js',
        'ptc-poe1.js',
        'ptc-poe2.js',
        'ptc-settings.js',
        'ptc-modtext.js',
        'coe.js',
        'background.js',
      ],
    },
    action: chrome.action,
    sidebar_action: {
      default_panel: 'sidepanel.html',
      default_title: chrome.name,
      default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png' },
      open_at_install: false,
    },
    icons: chrome.icons,
    content_scripts: content,
  };
  return manifest;
}

/* The Firefox package must not contain a single Chrome-only API call. The AMO
   validator reports those as "not supported by Firefox" even when they sit
   behind a runtime guard, so lines marked "chrome-only" are dropped here and a
   line marked "chrome-only:" replaces itself with the text after the colon. */
function stripChromeOnly(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const kept = [];
  let dropped = 0;
  lines.forEach((line) => {
    const replacement = /\/\/ chrome-only:\s?(.*)$/.exec(line);
    if (replacement) {
      kept.push(replacement[1]);
      return;
    }
    if (/\/\/ chrome-only\s*$/.test(line)) {
      dropped += 1;
      return;
    }
    kept.push(line);
  });
  const result = kept.join('\n');
  const survivor = /\bchrome\.(sidePanel|offscreen)\b/.exec(result);
  if (survivor) {
    throw new Error(
      'A Chrome-only API survived the Firefox build in ' + path.basename(file) +
      ': ' + survivor[0],
    );
  }
  fs.writeFileSync(file, result);
  return dropped;
}

function main() {
  const chrome = readJson(path.join(SRC, 'manifest.json'));
  if (!/^PoeTradeFirefox$/.test(path.basename(OUT))) {
    throw new Error('Refusing to write outside the expected folder: ' + OUT);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  FILES.forEach((file) => {
    const from = path.join(SRC, file);
    if (!fs.existsSync(from)) throw new Error('Missing file: ' + file);
    fs.copyFileSync(from, path.join(OUT, file));
  });
  DIRS.forEach((dir) => copyDir(path.join(SRC, dir), path.join(OUT, dir)));

  const dropped = stripChromeOnly(path.join(OUT, 'background.js'));

  const manifest = firefoxManifest(chrome);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const count = FILES.length + DIRS.reduce((total, dir) => {
    return total + fs.readdirSync(path.join(SRC, dir), { recursive: true })
      .filter((name) => fs.statSync(path.join(SRC, dir, name)).isFile()).length;
  }, 0) + 1;

  console.log('Firefox build written to ' + OUT);
  console.log('  version ' + manifest.version + ' · ' + count + ' files');
  console.log('  permissions: ' + manifest.permissions.join(', '));
  console.log('  optional: ' + (manifest.optional_permissions || []).join(', '));
  console.log('  panel: sidebar_action -> ' + manifest.sidebar_action.default_panel);
  console.log('  background: ' + manifest.background.scripts.join(', '));
  console.log('  chrome-only lines removed from background.js: ' + dropped);
}

main();
