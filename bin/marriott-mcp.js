#!/usr/bin/env node
// MCP server entry point. Speaks JSON-RPC on stdio — never write to stdout from here.
import { serve } from '../src/mcp.js';

const argv = process.argv.slice(2);
serve({
  verbose: argv.includes('--verbose') || !!process.env.MARRIOTT_VERBOSE,
  // Chrome is parked off-screen by default so the server never steals focus. Pass
  // --show (or MARRIOTT_SHOW=1) when you want to watch what it is doing.
  hidden: !(argv.includes('--show') || process.env.MARRIOTT_SHOW === '1'),
  attach: process.env.MARRIOTT_ATTACH ? Number(process.env.MARRIOTT_ATTACH) : null,
});
