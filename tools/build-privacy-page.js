'use strict';
/*
 * Writes the public copy of the privacy policy.
 *
 *   node tools/build-privacy-page.js
 *
 * The extension ships privacy.html, which loads themes.css and privacy.js so it
 * matches the panel. A public page served from GitHub Pages has neither, so
 * this copies the same <main> into docs/privacy.html with one small inline
 * stylesheet. The text lives in exactly one place: privacy.html.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const FROM = path.join(SRC, 'privacy.html');
const TO = path.join(SRC, 'docs', 'privacy.html');

const css = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 40px 20px 64px;
  background: #0d1017;
  color: #e6e9f0;
  font: 14px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 720px; margin: 0 auto; }
h1 { margin: 0 0 6px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: #eef1f7; }
h2 { margin: 32px 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #8b93a7; }
p, li { margin: 8px 0; color: #c3c9d8; }
ul { padding-left: 20px; }
li { margin: 6px 0; }
strong { color: #eef1f7; font-weight: 600; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; color: #d8b56a; }
a { color: #d8b56a; text-decoration: none; border-bottom: 1px solid #4a4128; }
a:hover { border-bottom-color: #d8b56a; }
.updated { color: #8b93a7; font-size: 12px; margin-top: 0; }
.disclaimer { margin-top: 32px; border-top: 1px solid #242a38; padding-top: 14px; color: #8b93a7; font-size: 12px; }`;

function main() {
  const source = fs.readFileSync(FROM, 'utf8');
  const match = /<main>[\s\S]*<\/main>/.exec(source);
  if (!match) throw new Error('No <main> block in privacy.html');
  const body = match[0].trim();

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy - Poe Trade Watcher</title>
<!-- Generated from privacy.html by tools/build-privacy-page.js. Do not edit by hand. -->
<style>
${css}
</style>
</head>
<body>
${body}
<p class="disclaimer">Poe Trade Watcher is an unofficial fan-made extension. It is not affiliated with, endorsed by, or sponsored by Grinding Gear Games.</p>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(TO), { recursive: true });
  fs.writeFileSync(TO, page);
  console.log('Public privacy page written to ' + TO);
  console.log('  ' + Buffer.byteLength(page) + ' bytes, copied from privacy.html');
}

main();
