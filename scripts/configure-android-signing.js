const fs = require('node:fs');

const path = 'android/app/build.gradle';
let gradle = fs.readFileSync(path, 'utf8');

if (!/buildTypes\s*\{/.test(gradle)) {
  throw new Error('Could not find buildTypes in generated Android build.gradle');
}
if (!/release\s*\{/.test(gradle)) {
  throw new Error('Could not find release build type in generated Android build.gradle');
}

if (!/signingConfigs\s*\{/.test(gradle)) {
  const block = `
    signingConfigs {
        release {
            storeFile file("kk-player-release.jks")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

`;
  gradle = gradle.replace(/(\s*buildTypes\s*\{)/, block + '$1');
}

const buildTypesIndex = gradle.search(/buildTypes\s*\{/);
const releaseMatch = /release\s*\{/.exec(gradle.slice(buildTypesIndex));
if (!releaseMatch) throw new Error('Release block was not found after buildTypes');
const releaseOpen = buildTypesIndex + releaseMatch.index + releaseMatch[0].length;
const afterOpen = gradle.slice(releaseOpen);
if (!/signingConfig\s+signingConfigs\.release/.test(afterOpen.split(/\n\s*}/, 1)[0])) {
  gradle = gradle.slice(0, releaseOpen) + '\n            signingConfig signingConfigs.release' + gradle.slice(releaseOpen);
}

fs.writeFileSync(path, gradle);
