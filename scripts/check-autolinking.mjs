#!/usr/bin/env node
// Fails unless the Android autolinkers (React Native CLI and Expo) detect only
// NitroUiPackage. Both find the `ReactPackage` class with a regex over the raw
// source, so a doc comment shaped like a class declaration can win.
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
// (build/reactNativeConfig/androidResolver.js).
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
