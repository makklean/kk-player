const fs = require('node:fs');
const path = 'android/app/build.gradle';
let gradle = fs.readFileSync(path, 'utf8');
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+["'][^"']+["']/.test(gradle)) {
  throw new Error('Could not find versionCode/versionName in generated Android build.gradle');
}
gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode 5');
gradle = gradle.replace(/versionName\s+["'][^"']+["']/, 'versionName "1.5"');
fs.writeFileSync(path, gradle);
