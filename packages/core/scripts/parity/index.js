// Entry point for `node --test scripts/parity`.
//
// Node 22 runs a directory argument to `--test` as a module rather than
// searching it for test files, so the directory resolves here (CommonJS
// directory resolution picks `index.js`; the package is `"type": "module"`,
// so this file is ESM) and this file pulls in every test in the directory.
import "./metrics.test.mjs";
import "./ids.test.mjs";
import "./cli.test.mjs";
