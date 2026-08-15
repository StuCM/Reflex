#!/usr/bin/env node
// Says what this machine can and cannot prove, before anyone tries.
//
// This exists because agents kept "fixing" failures that were the environment:
// a sideload with no TV paired, a proxy 403 read as a broken request. Naming
// the ceiling up front is cheaper than three agents rediscovering it.
'use strict';

var path = require('path');
var execSync = require('child_process').execSync;

var root = path.resolve(__dirname, '..', '..', '..');
var cfg = require(path.join(root, '.claude', 'crew.config.json'));

var target = process.argv[2] || 'laptop';
var env = cfg.environments[target];

if (!env) {
  console.error('unknown environment "' + target + '" — known: ' +
                Object.keys(cfg.environments).join(', '));
  process.exit(2);
}

console.log('environment: ' + target);
console.log('proves     : ' + env.proves.join(', '));

if (env.reachableFromAgents === false) {
  console.log('\nNOT REACHABLE FROM AN AGENT.');
  console.log(env.note || '');
  console.log('\nA task needing this environment is code-complete at best.');
  console.log('Mark it pending-tv and stop. Do not try to make it pass here.');
  process.exit(3);
}

var missing = (cfg.deploy.requires || []).filter(function (bin) {
  try { execSync('command -v ' + bin, { stdio: 'ignore' }); return false; }
  catch (e) { return true; }
});

if (missing.length) {
  console.log('\nmissing tools: ' + missing.join(', '));
  console.log('This machine cannot deploy. That is expected off the TV bench,');
  console.log('and is not a bug to fix.');
}

console.log('\nverify: ' + cfg.verify);
