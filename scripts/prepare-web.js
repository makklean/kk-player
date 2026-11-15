const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'www');
const vendor = path.join(output, 'vendor');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });

for (const file of ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png']) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) {
    throw new Error(`Required web asset is missing: ${file}`);
  }
  fs.copyFileSync(source, path.join(output, file));
}

const indexPath = path.join(output, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const remoteJsZipTag = '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>';
if (!html.includes(remoteJsZipTag)) {
  throw new Error('Could not find the expected JSZip CDN script tag in index.html');
}

const jsZipSource = path.join(root, 'node_modules', 'jszip', 'dist', 'jszip.min.js');
if (!fs.existsSync(jsZipSource)) {
  throw new Error('JSZip package is not installed. Run npm install first.');
}
fs.copyFileSync(jsZipSource, path.join(vendor, 'jszip.min.js'));
html = html.replace(remoteJsZipTag, '<script src="./vendor/jszip.min.js"></script>');
fs.writeFileSync(indexPath, html, 'utf8');

console.log('Prepared offline-capable Capacitor web assets in www/.');
