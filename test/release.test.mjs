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
  // npm matches the trusted publisher by the *file* of the workflow, not by
  // the name in it: this file has to be called publish.yml, and it is read
  // from this very path, so a workflow that is moved or renamed cannot pass
  // this test. The name in the file is only what the page of a run shows.
  assert.match(workflow, /^name: publish$/m);
  // The package is published with the identity of GitHub Actions; a token
  // would mean that the identity of a person is used instead.
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
  // The token of the OIDC comes from here; without it npm has nothing to
  // exchange for a publishing token.
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /contents: read/);
  // The registry is written down, and the cache of the build is not used: a
  // cache may hold the credentials of the build.
  assert.match(workflow, /registry-url: 'https:\/\/registry\.npmjs\.org'/);
  assert.doesNotMatch(workflow, /package-manager-cache/);
  // npm exchanges the OIDC token by itself from npm 11.5.1 on, and that npm
  // needs Node 22.14.0 or newer. The workflow uses a Node that carries it.
  assert.match(workflow, /node-version: '24'/);

  // The two jobs: one checks the release, the other publishes it.
  assert.match(workflow, /^  verify:$/m);
  assert.match(workflow, /^  publish:$/m);
  assert.match(workflow, /needs: verify/);
  // The rules are run before the code of the release is even tested.
  const guard = workflow.indexOf('node scripts/verify-release.mjs');
  const tests = workflow.indexOf('run: npm test');
  assert.ok(guard !== -1 && tests !== -1 && guard < tests, 'the guard runs before the tests');
  // The package is handed over from one job to the other, so that the job
  // with the OIDC token never runs the code of the release.
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /uses: actions\/download-artifact@v4/);
});

test('the job that publishes runs no code of the repository', async () => {
  const workflow = await read('.github/workflows/publish.yml');
  const start = workflow.indexOf('\n  publish:\n');
  assert.ok(start !== -1, 'the publish job is there');
  const job = workflow.slice(start);
  // The code of the release is checked in the other job. Here there is only
  // the package that was checked, and it is published as it is.
  assert.doesNotMatch(job, /npm test/);
  assert.doesNotMatch(job, /npm run check:syntax/);
  assert.doesNotMatch(job, /actions\/checkout/);
  assert.match(job, /npm publish dist\/\*\.tgz/);
});

test('the package says which repository it comes from', async () => {
  const pkg = JSON.parse(await read('package.json'));
  // The trusted publisher is bound to one repository, and npm reads that
  // repository out of this field. A package without it cannot be published
  // from GitHub Actions at all, and a package that names another repository
  // is published under another identity: the name is written down here.
  assert.match(pkg.repository?.url || '', /github\.com\/liuzq1103\/magpie-page-token-widget/);
  assert.ok(pkg.version, 'the package has a version');
});
