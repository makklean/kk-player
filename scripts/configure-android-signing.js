const fs = require('node:fs');

const path = 'android/app/build.gradle';
let gradle = fs.readFileSync(path, 'utf8');

function findBlock(source, name, from = 0, limit = source.length) {
  const pattern = new RegExp('\\b' + name + '\\s*\\{', 'g');
  pattern.lastIndex = from;
  const match = pattern.exec(source);
  if (!match || match.index >= limit) return null;

  const open = source.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < limit; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return { start: match.index, open, close: i };
    }
  }
  throw new Error('Unclosed ' + name + ' block in generated Android build.gradle');
}

let android = findBlock(gradle, 'android');
if (!android) throw new Error('Could not find android block in generated Android build.gradle');

let buildTypes = findBlock(gradle, 'buildTypes', android.open + 1, android.close);
if (!buildTypes) throw new Error('Could not find buildTypes in generated Android build.gradle');

let signingConfigs = findBlock(gradle, 'signingConfigs', android.open + 1, android.close);
if (!signingConfigs) {
  gradle = gradle.slice(0, buildTypes.start) +
    '    signingConfigs {\n    }\n\n' +
    gradle.slice(buildTypes.start);
  android = findBlock(gradle, 'android');
  buildTypes = findBlock(gradle, 'buildTypes', android.open + 1, android.close);
  signingConfigs = findBlock(gradle, 'signingConfigs', android.open + 1, android.close);
}

const releaseSigning = [
  '        release {',
  '            storeFile file("kk-player-release.jks")',
  '            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")',
  '            keyAlias System.getenv("ANDROID_KEY_ALIAS")',
  '            keyPassword System.getenv("ANDROID_KEY_PASSWORD")',
  '        }'
].join('\n');

const existingReleaseConfig = findBlock(gradle, 'release', signingConfigs.open + 1, signingConfigs.close);
if (!existingReleaseConfig) {
  gradle = gradle.slice(0, signingConfigs.close) + '\n' + releaseSigning + '\n    ' + gradle.slice(signingConfigs.close);
}

android = findBlock(gradle, 'android');
buildTypes = findBlock(gradle, 'buildTypes', android.open + 1, android.close);
const releaseType = findBlock(gradle, 'release', buildTypes.open + 1, buildTypes.close);
if (!releaseType) throw new Error('Could not find release build type in generated Android build.gradle');

const releaseBody = gradle.slice(releaseType.open + 1, releaseType.close);
if (!/\bsigningConfig\s+signingConfigs\.release\b/.test(releaseBody)) {
  gradle = gradle.slice(0, releaseType.open + 1) +
    '\n            signingConfig signingConfigs.release' +
    gradle.slice(releaseType.open + 1);
}

fs.writeFileSync(path, gradle);
