#!/usr/bin/env node
// Builds the demo repository in a temp dir and runs cleanbreak against it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { buildDemo } from './demo-repo.js';

const dir = buildDemo(join(mkdtempSync(join(tmpdir(), 'cleanbreak-demo-')), 'shop'));
console.error(`demo repo: ${dir}\n`);
process.exitCode = main(['-C', dir, '--verify', 'node main.js', ...process.argv.slice(2)]);
