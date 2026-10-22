// Post-nitrogen fix-up: restore Android base ViewProps on RN >= 0.87 (margelo/nitro#1656)
// with react-native-nitro-modules 0.37.1. Idempotent; exits 1 if a file can't be patched.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.argv[2] ?? '.', 'nitrogen/generated/shared/c++/views');
const MARK = '// nitro-ui: initializeDynamicProps';
let failed = false;
for (const f of readdirSync(dir).filter((f) => f.endsWith('Component.cpp'))) {
  const p = join(dir, f);
  let s = readFileSync(p, 'utf8');
  if (s.includes(MARK)) continue;
  if (s.includes('RawPropsCompat::initializeDynamicProps')) continue; // upstream fix present
  const re = /\) \{ \}(\n\n  bool \w+::filterObjectKeys)/;
  if (!re.test(s)) { console.error(`patch-nitrogen: pattern not found in ${f}`); failed = true; continue; }
  s = s.replace('#include <NitroModules/ReactProp.hpp>',
    '#include <NitroModules/ReactProp.hpp>\n#include "NitroUiPropsCompat.hpp"');
  s = s.replace(re, `) {\n    ${MARK}\n    ::nitroui::compat::initializeDynamicProps(*this, sourceProps, rawProps, filterObjectKeys);\n  }$1`);
  writeFileSync(p, s);
  console.log(`patch-nitrogen: patched ${f}`);
}
process.exit(failed ? 1 : 0);
