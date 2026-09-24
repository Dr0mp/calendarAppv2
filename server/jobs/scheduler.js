import { Cron } from 'croner';
import { pruneSessions } from '../auth/sessions.js';
import { pruneTokens } from '../auth/tokens.js';
import { pruneRateLimits } from '../auth/ratelimit.js';

/**
 * Scheduled jobs: demo reset (daily at DEMO_RESET_HOUR, organisation time
 * zone), session/token pruning and media cleanup (hourly), nightly backups.
 * @param {import('../app.js').App} app
 * @param {{mediaCleanup?: () => void, backup?: () => Promise<void>}} [extra]
 */
export function startJobs(app, extra = {}) {
  const tz = app.workspaces.main.tz();
  /** @type {Cron[]} */ const jobs = [];
  const safe = (name, fn) => async () => {
    try {
      await fn();
    } catch (err) {
      app.log.error({ err, job: name }, 'job failed');
    }
  };

  if (app.config.demoEnabled) {
    jobs.push(new Cron(`0 ${app.config.demoResetHour} * * *`, { timezone: tz, name: 'demo-reset' }, safe('demo-reset', () => app.resetDemo())));
  }
  jobs.push(
    new Cron('7 * * * *', { name: 'prune' }, safe('prune', () => {
      pruneSessions(app.authDb, app.config);
      pruneTokens(app.authDb);
      pruneRateLimits(app.authDb);
    })),
  );
  if (extra.mediaCleanup) jobs.push(new Cron('17 * * * *', { name: 'media-cleanup' }, safe('media-cleanup', extra.mediaCleanup)));
  if (extra.backup) jobs.push(new Cron('30 2 * * *', { timezone: tz, name: 'backup' }, safe('backup', extra.backup)));
  return { stop: () => jobs.forEach((j) => j.stop()), jobs };
}
