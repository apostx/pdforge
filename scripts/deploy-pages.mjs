// Publishes dist/ to the gh-pages branch, for GitHub Pages "Deploy from a branch".
// This is the manual route that needs no GitHub Actions: run `npm run deploy`.
// Extra arguments are added to the deploy commit message as further paragraphs.
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'dist');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}

const remote = git(['remote', 'get-url', 'origin']);
const source = git(['rev-parse', '--short', 'HEAD']);
const dirty = git(['status', '--porcelain']) !== '';
const work = mkdtempSync(join(tmpdir(), 'pdforge-pages-'));

try {
  // continue the existing branch so its history is kept, or start it
  const exists = git(['ls-remote', '--heads', remote, 'gh-pages']) !== '';
  if (exists) {
    git(['clone', '--quiet', '--branch', 'gh-pages', '--single-branch', '--depth', '1', remote, work]);
  } else {
    git(['init', '--quiet', '--initial-branch', 'gh-pages'], work);
    git(['remote', 'add', 'origin', remote], work);
  }

  for (const entry of readdirSync(work)) {
    if (entry !== '.git') rmSync(join(work, entry), { recursive: true, force: true });
  }
  cpSync(dist, work, { recursive: true });
  // without this, Pages runs the site through Jekyll, which drops files starting with "_"
  writeFileSync(join(work, '.nojekyll'), '');

  git(['add', '--all'], work);
  if (git(['status', '--porcelain'], work) === '') {
    console.log('gh-pages is already up to date.');
  } else {
    const message = [`Deploy ${source}${dirty ? ' (with uncommitted changes)' : ''}`, ...process.argv.slice(2)];
    git(['commit', '--quiet', ...message.flatMap((paragraph) => ['-m', paragraph])], work);
    git(['push', '--quiet', 'origin', 'gh-pages'], work);
    console.log(`Published ${source} to gh-pages.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
