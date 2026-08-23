import { execSync } from 'child_process';

let cachedCommitId: string | null = null;

/**
 * Returns the current Git commit hash (SHA-1) to embed in every trade record and log entry.
 */
export function getGitCommitId(): string {
  if (cachedCommitId) {
    return cachedCommitId;
  }

  // 1. Check environment variable (useful in Docker / CI/CD)
  if (process.env.GIT_COMMIT_ID) {
    cachedCommitId = process.env.GIT_COMMIT_ID.trim();
    return cachedCommitId;
  }

  // 2. Try querying git CLI
  try {
    const hash = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    cachedCommitId = hash.trim();
    return cachedCommitId;
  } catch {
    cachedCommitId = 'unknown-build';
    return cachedCommitId;
  }
}
