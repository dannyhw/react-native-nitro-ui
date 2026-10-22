#!/usr/bin/env node
// Regression guard for consumer autolinking.
//
// Both Android autolinkers detect our `ReactPackage` class by running a regex
// over the RAW source file - no compiler involved:
//   - React Native CLI: @react-native-community/cli-config-android
//     findPackageClassName.js `matchClassName`
//   - Expo: expo-modules-autolinking reactNativeConfig/androidResolver.js
//     `matchNativePackageClassName` (two regexes)
// Both regexes are greedy across newlines, so a KDoc sentence shaped like a
// declaration (`class X … :` / `implements … ReactPackage`) anywhere before the
// real class wins, and every consumer build then fails on a phantom class name
// (Expo silently drops the library instead). That bit us once; see the note in
// android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt.
//
// This script runs the real RN CLI detector plus Expo's regexes over our
// android/ tree and fails if anything other than NitroUiPackage is detected.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const androidDir = path.join(repoRoot, 'android');
const EXPECTED = 'NitroUiPackage';

// Copy of expo-modules-autolinking's two regexes
// (build/reactNativeConfig/androidResolver.js:195 and :203).
const EXPO_REGEXES = [
  /class\s+(\w+[^(\s]*)[\s\w():]*(\s+implements\s+|:)[\s\w():,]*[^{]*ReactPackage/,
  /class\s+(\w+[^(\s]*)[\s\w():]*(\s+extends\s+|:)[\s\w():,]*[^{]*(Base|Turbo)ReactPackage/,
];

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'build' && entry.name !== '.cxx') {
        found.push(...sourceFiles(path.join(dir, entry.name)));
      }
    } else if (/\.(java|kt)$/.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found.sort();
}

const files = sourceFiles(androidDir);
assert.ok(files.length > 0, `no Java/Kotlin sources found under ${androidDir}`);

// [1] React Native CLI - the real detector, not a copy of it.
const {
  default: getPackageClassName,
} = require('@react-native-community/cli-config-android/build/config/findPackageClassName.js');
const rnCliResult = getPackageClassName(androidDir);
assert.equal(
  rnCliResult,
  EXPECTED,
  `React Native CLI autolinking resolved "${rnCliResult}", expected "${EXPECTED}"`
);

// [2] Expo - its own regexes, over the same files Expo would scan.
let expoResult = null;
for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  for (const regex of EXPO_REGEXES) {
    const match = contents.match(regex);
    if (match?.[1]) {
      expoResult = match[1];
      break;
    }
  }
  if (expoResult) break;
}
assert.equal(
  expoResult,
  EXPECTED,
  `Expo autolinking resolved "${expoResult}", expected "${EXPECTED}"`
);

console.log(`autolinking: RN CLI and Expo both resolve ${EXPECTED}`);
