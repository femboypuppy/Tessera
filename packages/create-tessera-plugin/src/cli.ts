#!/usr/bin/env node
import { run } from './run';

process.exitCode = run(process.argv.slice(2));
