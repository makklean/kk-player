const fs = require('node:fs');
const path = 'android/app/src/main/AndroidManifest.xml';
let xml = fs.readFileSync(path, 'utf8');
const activity = /<activity\\b(?=[^>]*android:name="[^"]*MainActivity")[^>]*>/;
const match = xml.match(activity);
if (!match) throw new Error('MainActivity declaration not found in AndroidManifest.xml');
if (!/android:screenOrientation=/.test(match[0])) {
  xml = xml.replace(activity, match[0].replace(/>$/, ' android:screenOrientation="portrait">'));
} else {
  xml = xml.replace(activity, match[0].replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="portrait"'));
}
fs.writeFileSync(path, xml);
