// The guard of a release.
//
// npm trusts a workflow by its name and by the repository it runs in, not by
// the branch it runs from: a run of this file from a tag was accepted by npm
// and the provenance of it says so. So the rules that decide whether a
// release may go out live here, in one file, and the tests of the workflow
// run this very file against little repositories of their own.
//
// The rules:
//   1. the tag is the name of a version;
//   2. the tag is a tag of this repository, and it says which commit it means;
//   3. that commit is on the main branch;
//   4. the version in package.json of that commit is the version of the tag;
//   5. the rules themselves were not changed by that commit.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Only a plain version goes out. A pre-release would become the version
// everybody gets, and the pre-releases of GitHub fire this workflow as well.
const TAG_PATTERN = /^(?:v)?(\d+\.\d+\.\d+)$/;

// The files that hold the rules. A release that changed one of them would be
// published under other rules than the ones that are written down here, so
// such a release is refused.
const FILES_UNDER_TRUST = ['.github/workflows/publish.yml', 'scripts/verify-release.mjs'];

const run = (args, cwd) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
};

export function parseArguments(argv) {
  const options = { cwd: process.cwd(), base: 'main', tag: '', expectSha: '', workflowRef: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--')) continue;
    const key = name.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : '';
    if (value) index += 1;
    if (key === 'tag') options.tag = value;
    else if (key === 'expect-sha') options.expectSha = value;
    else if (key === 'base') options.base = value;
    else if (key === 'workflow-ref') options.workflowRef = value;
    else if (key === 'cwd') options.cwd = path.resolve(value);
  }
  return options;
}

export function verify(options = {}) {
  const cwd = options.cwd || process.cwd();
  const base = options.base || 'main';
  const tag = options.tag || '';
  const problems = [];
  const notes = [];
  const result = { ok: false, problems, notes, commit: '', version: '' };

  if (!TAG_PATTERN.test(tag)) {
    problems.push(`the tag "${tag}" is not the name of a version`);
    return result;
  }
  const version = tag.replace(/^v/, '');
  result.version = version;

  // The tag is read as a tag, never as a branch that happens to have the
  // same name.
  let resolved = run(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], cwd);
  if (resolved.status !== 0) {
    // The tags are not always in the checkout; they are asked for when they
    // are not there.
    run(['fetch', '--force', '--tags', 'origin'], cwd);
    resolved = run(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], cwd);
  }
  if (resolved.status !== 0 || !resolved.stdout) {
    problems.push(`the tag "${tag}" is not a tag of this repository`);
    return result;
  }
  const commit = resolved.stdout;
  result.commit = commit;

  if (options.expectSha && options.expectSha !== commit) {
    problems.push(
      `the tag "${tag}" means the commit ${commit.slice(0, 12)}, and the release says ${options.expectSha.slice(0, 12)}`,
    );
  }

  // The whole history of the main branch is needed to say whether a commit
  // is on it. A checkout that was cut short cannot answer that.
  const shallow = run(['rev-parse', '--is-shallow-repository'], cwd);
  if (shallow.stdout === 'true') {
    run(['fetch', '--unshallow', '--no-tags', 'origin'], cwd);
    const stillShallow = run(['rev-parse', '--is-shallow-repository'], cwd);
    if (stillShallow.stdout === 'true') {
      problems.push('the history of this checkout is cut short, so it cannot be said whether the release is on the branch');
      return result;
    }
  }

  const baseRef = `refs/remotes/origin/${base}`;
  let known = run(['rev-parse', '--verify', '--quiet', baseRef], cwd);
  if (known.status !== 0) {
    const fetched = run(
      ['fetch', '--no-tags', '--force', 'origin', `+refs/heads/${base}:${baseRef}`],
      cwd,
    );
    known = run(['rev-parse', '--verify', '--quiet', baseRef], cwd);
    if (known.status !== 0) {
      problems.push(`the branch "${base}" is not known here, so it cannot be said whether the release is on it`);
      return result;
    }
    if (fetched.status !== 0) notes.push(`the branch "${base}" came with a warning: ${fetched.stderr}`);
  }

  const ancestor = run(['merge-base', '--is-ancestor', commit, baseRef], cwd);
  if (ancestor.status !== 0) {
    problems.push(`the commit ${commit.slice(0, 12)} of the tag "${tag}" is not on the branch "${base}"`);
  }

  // The version is read at the commit of the tag, not in the working copy.
  const packageJson = run(['show', `${commit}:package.json`], cwd);
  if (packageJson.status !== 0) {
    problems.push('package.json cannot be read at the commit of the tag');
  } else {
    let found = '';
    try {
      found = JSON.parse(packageJson.stdout).version || '';
    } catch {
      found = '';
    }
    if (found !== version) {
      problems.push(`the tag says ${version}, and package.json of that commit says ${found || '(nothing)'}`);
    }
  }

  // The rules may not be changed by the release itself.
  for (const file of FILES_UNDER_TRUST) {
    const candidate = run(['show', `${commit}:${file}`], cwd);
    const trusted = run(['show', `${baseRef}:${file}`], cwd);
    if (candidate.status !== 0 || trusted.status !== 0) {
      problems.push(`${file} cannot be read, so it cannot be said whether the release goes out under the trusted rules`);
      continue;
    }
    if (candidate.stdout !== trusted.stdout) {
      problems.push(`${file} is different in the commit of the tag than on the branch "${base}"`);
    }
  }

  // The workflow that is running has to be the trusted one as well: the run
  // may come from the tag, and a tag may carry another workflow.
  if (options.workflowRef) {
    const running = run(['show', `${options.workflowRef}:.github/workflows/publish.yml`], cwd);
    const trusted = run(['show', `${baseRef}:.github/workflows/publish.yml`], cwd);
    if (running.status !== 0) {
      problems.push(`the workflow of the run (${options.workflowRef}) cannot be read`);
    } else if (running.stdout !== trusted.stdout) {
      problems.push(`the workflow of the run (${options.workflowRef}) is not the one of the branch "${base}"`);
    }
  }

  result.ok = problems.length === 0;
  return result;
}

const main = (argv) => {
  const options = parseArguments(argv);
  const result = verify(options);
  result.notes.forEach((note) => console.log(note));
  if (!result.ok) {
    result.problems.forEach((problem) => console.error(`this release may not go out: ${problem}`));
    process.exit(1);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `commit=${result.commit}\nversion=${result.version}\n`);
  }
  console.log(
    `the release ${options.tag} is the commit ${result.commit.slice(0, 12)} on ${options.base}, and its version is ${result.version}`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
