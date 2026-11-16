const fs = require('node:fs');

const path = 'android/app/build.gradle';
let gradle = fs.readFileSync(path, 'utf8');

if (!/buildTypes\\s*\\{/.test(gradle)) {
  throw new Error('Could not find buildTypes in generated Android build.gradle');
}
if (!/buildTypes\\s*\\{[\\s\\S]*?\\brelease\\s*\\{/.test(gradle)) {
  throw new Error('Could not find release build type in generated Android build.gradle');
}

const releaseSigning = `
    release {
        storeFile file("kk-player-release.jks")
        storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
        keyAlias System.getenv("ANDROID_KEY_ALIAS")
        keyPassword System.getenv("ANDROID_KEY_PASSWORD")
    }
`;

const signingConfigsMatch = /signingConfigs\\s*\\{/.exec(gradle);
if (signingConfigsMatch) {
  if (!/signingConfigs\\s*\\{[\\s\\S]*?\\brelease\\s*\\{/.test(gradle)) {
    const insertAt = signingConfigsMatch.index + signingConfigsMatch[0].length;
    gradle = gradle.slice(0, insertAt) + releaseSigning + gradle.slice(insertAt);
  }
} else {
  const block = `
    signingConfigs {
${releaseSigning}
    }

`;
  gradle = gradle.replace(/(\\s*buildTypes\\s*\\{)/, block + '$1');
}

if (!/buildTypes\\s*\\{[\\s\\S]*?\\brelease\\s*\\{[\\s\\S]*?signingConfig\\s+signingConfigs\\.release/.test(gradle)) {
  gradle = gradle.replace(/(buildTypes\\s*\\{[\\s\\S]*?\\brelease\\s*\\{)/, '$1\\n            signingConfig signingConfigs.release');
}

fs.writeFileSync(path, gradle);
