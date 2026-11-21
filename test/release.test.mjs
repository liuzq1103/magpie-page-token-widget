import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The line endings of the checkout are not the same on every computer: a
// page read on Windows ends its lines with CRLF. The tests look at the
// lines, so they all read the same line endings.
const read = async (file) => (await readFile(path.join(root, file), 'utf8')).replace(/\r\n/g, '\n');

test('the package is published with the identity of GitHub Actions', async () => {
  const workflow = await read('.github/workflows/publish.yml');
  // The name of this file is the name that is written down in the settings of
  // the package on npmjs.com. A release that is published with another name
  // is refused by npm, and the reason is not said anywhere but in the log of
  // the run.
  assert.match(workflow, /^name: publish$/m);
  // The token of the OIDC comes from here; without it npm has nothing to
  // exchange for a publishing token.
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /contents: read/);
  // The registry is written down, and the cache of the build is not used: a
  // cache may hold the credentials of the build.
  assert.match(workflow, /registry-url: 'https:\/\/registry\.npmjs\.org'/);
  assert.match(workflow, /package-manager-cache: false/);
  // npm exchanges the OIDC token by itself from npm 11.5.1 on, and that npm
  // needs Node 22.14.0 or newer. The workflow uses a Node that carries it.
  assert.match(workflow, /node-version: '24'/);
  // The publish itself, and the two guards in front of it: a release that is
  // not on main, or a tag that does not match the version, publishes nothing.
  assert.match(workflow, /run: npm publish/);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(workflow, /tag="\$\{TAG#v\}"/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
});

test('the package says which repository it comes from', async () => {
  const pkg = JSON.parse(await read('package.json'));
  // The trusted publisher is bound to one repository, and npm reads that
  // repository out of this field. A package without it cannot be published
  // from GitHub Actions at all.
  assert.match(pkg.repository?.url || '', /github\.com/);
  assert.ok(pkg.version, 'the package has a version');
});
