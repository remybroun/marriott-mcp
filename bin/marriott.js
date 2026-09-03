#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`marriott: ${err.message}`);
    process.exit(1);
  });
