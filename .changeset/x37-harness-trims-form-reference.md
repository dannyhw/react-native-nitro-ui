---
'react-native-nitro-ui': patch
---

The SwiftUI `Form` that existed only for the harness's fidelity comparison is no longer shipped: `NitroUiFormReference.swift`, its `show-reference` / `hide-reference` test commands and the spec text describing them were test-only code in the published package, and the two Android regressions they travelled with now live in `Form.harness.tsx`.
