// The rules of a release are run by a script, and this file runs that very
// script against little repositories of its own. Every rule is therefore
// checked by what it does, and not by the words of the workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verify } from '../scripts/verify-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardPath = path.join(root, 'scripts', 'verify-release.mjs');
const workflowPath = path.join(root, '.github', 'workflows', 'publish.yml');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const repository = (version = '1.0.0') => {
  const folder = mkdtempSync(path.join(tmpdir(), 'release-guard-'));
  git(['init', '-b', 'main'], folder);
  git(['config', 'user.email', 'guard@example.com'], folder);
  git(['config', 'user.name', 'guard'], folder);
  // The line endings of this computer are not written into the little
  // repository, so the files of the rules stay the way they were written.
  git(['config', 'core.autocrlf', 'false'], folder);
  // The two files that hold the rules are the ones of this repository, so
  // that a release which does not touch them passes the rule about them.
  mkdirSync(path.join(folder, 'scripts'), { recursive: true });
  mkdirSync(path.join(folder, '.github', 'workflows'), { recursive: true });
  writeFileSync(path.join(folder, 'scripts', 'verify-release.mjs'), readFileSync(guardPath));
  writeFileSync(path.join(folder, '.github', 'workflows', 'publish.yml'), readFileSync(workflowPath));
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'a-package', version }, null, 2));
  git(['add', '-A'], folder);
  git(['commit', '-m', 'the first commit'], folder);
  // The branch of the origin, as a checkout of a workflow has it.
  git(['update-ref', 'refs/remotes/origin/main', git(['rev-parse', 'HEAD'], folder)], folder);
  return folder;
};

const commit = (folder, version, message) => {
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'a-package', version }, null, 2));
  git(['add', '-A'], folder);
  git(['commit', '-m', message], folder);
  return git(['rev-parse', 'HEAD'], folder);
};

const tag = (folder, name, at) => {
  git(['tag', name], folder, undefined);
  if (at) git(['tag', '-f', name, at], folder);
  return name;
};

const check = (folder, options = {}) => verify({ cwd: folder, base: 'main', ...options });

test('a tag on the main branch may go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  tag(folder, 'v1.0.0');
  const result = check(folder, { tag: 'v1.0.0' });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.version, '1.0.0');
});

test('a tag of an older commit of the main branch may go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const first = git(['rev-parse', 'HEAD'], folder);
  tag(folder, 'v1.0.0');
  commit(folder, '1.1.0', 'a later commit');
  // The main branch moved on after the tag was made. A checkout that was cut
  // short cannot say whether the tag is on the branch; a whole history can.
  const result = check(folder, { tag: 'v1.0.0' });
  assert.deepEqual(result.problems, []);
  assert.equal(result.commit, first);
});

test('a tag of a branch that is not on main may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  git(['checkout', '-b', 'side'], folder);
  commit(folder, '2.0.0', 'a commit on a side branch');
  tag(folder, 'v2.0.0');
  const result = check(folder, { tag: 'v2.0.0' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('is not on the branch "main"')),
    result.problems.join(' / '),
  );
});

test('a tag whose version is not the version of the commit may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  tag(folder, 'v9.9.9');
  const result = check(folder, { tag: 'v9.9.9' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('the tag says 9.9.9')),
    result.problems.join(' / '),
  );
});

test('a tag that is not a tag of this repository may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const result = check(folder, { tag: 'v1.0.0' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('is not a tag of this repository')),
    result.problems.join(' / '),
  );
});

test('a tag whose name is not a version may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  git(['tag', 'release'], folder);
  const result = check(folder, { tag: 'release' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('is not the name of a version')),
    result.problems.join(' / '),
  );
});

test('a pre-release may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  tag(folder, 'v1.0.0-rc.1');
  // A pre-release of GitHub fires the workflow as well, and npm would make
  // the pre-release the version everybody gets.
  const result = check(folder, { tag: 'v1.0.0-rc.1' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('is not the name of a version')),
    result.problems.join(' / '),
  );
});

test('a tag whose commit has no package.json may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  git(['checkout', '-b', 'side'], folder);
  rmSync(path.join(folder, 'package.json'));
  git(['add', '-A'], folder);
  git(['commit', '-m', 'the package.json is gone'], folder);
  tag(folder, 'v2.0.0');
  const result = check(folder, { tag: 'v2.0.0' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('package.json cannot be read')),
    result.problems.join(' / '),
  );
});

test('a release that changed the rules may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  git(['checkout', '-b', 'side'], folder);
  writeFileSync(path.join(folder, 'scripts', 'verify-release.mjs'), '// the rules are gone\n');
  git(['add', '-A'], folder);
  git(['commit', '-m', 'the rules are changed'], folder);
  commit(folder, '2.0.0', 'the version as well');
  tag(folder, 'v2.0.0');
  const result = check(folder, { tag: 'v2.0.0' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('scripts/verify-release.mjs is different')),
    result.problems.join(' / '),
  );
});

test('a release that changed the workflow may not go out', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  git(['checkout', '-b', 'side'], folder);
  writeFileSync(path.join(folder, '.github', 'workflows', 'publish.yml'), 'name: another\n');
  git(['add', '-A'], folder);
  git(['commit', '-m', 'the workflow is changed'], folder);
  commit(folder, '2.0.0', 'the version as well');
  tag(folder, 'v2.0.0');
  const result = check(folder, { tag: 'v2.0.0' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('.github/workflows/publish.yml is different')),
    result.problems.join(' / '),
  );
});

test('a run of another workflow may not publish', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  tag(folder, 'v1.0.0');
  git(['checkout', '-b', 'side'], folder);
  writeFileSync(path.join(folder, '.github', 'workflows', 'publish.yml'), 'name: another\n');
  git(['add', '-A'], folder);
  git(['commit', '-m', 'the workflow is changed'], folder);
  tag(folder, 'v2.0.0');
  const result = check(folder, { tag: 'v1.0.0', workflowRef: 'refs/tags/v2.0.0' });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('the workflow of the run')),
    result.problems.join(' / '),
  );
});

test('a release that names another commit may not publish', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  tag(folder, 'v1.0.0');
  const result = check(folder, { tag: 'v1.0.0', expectSha: '0'.repeat(40) });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((problem) => problem.includes('the release says')),
    result.problems.join(' / '),
  );
});

test('the script says no out loud, and says yes out loud', (t) => {
  const folder = repository('1.0.0');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  tag(folder, 'v1.0.0');
  const good = spawnSync(process.execPath, [guardPath, '--tag', 'v1.0.0', '--cwd', folder], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /is the commit/);

  const bad = spawnSync(process.execPath, [guardPath, '--tag', 'v9.9.9', '--cwd', folder], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /this release may not go out/);
});
