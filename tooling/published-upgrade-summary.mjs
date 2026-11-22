import assert from 'node:assert/strict';
import { targets } from './published-upgrade-plan.mjs';

const checksumLabels = {
  originalInstaller: 'Starting installer',
  manifest: 'Updater manifest',
  upgradeInstaller: 'Upgrade installer (verified by the updater)',
};

function versionText(version) {
  return /^\d+\.\d+\.\d+$/.test(version) ? `\`${version}\`` : 'Not reached';
}

function checksumRow(name, result) {
  if (!result) return `| ${name} | Not verified | — |`;
  const digest = /^(?:sha256:)?[a-f0-9]{64}$/.test(result.expected)
    ? `\`${result.expected.replace(/^sha256:/, '')}\``
    : null;
  const status = digest && result.actual === result.expected ? 'Passed' : 'Failed';
  return `| ${name} | ${status} | ${digest ?? '—'} |`;
}

function retryLine({ label, status, delayMs, attempt }) {
  const operation = /^[a-z0-9 .-]+$/i.test(label) ? label : 'GitHub release API';
  assert.ok(status === 403 || status === 429);
  assert.ok(Number.isSafeInteger(delayMs) && delayMs >= 0);
  assert.ok([1, 2, 3].includes(attempt));
  return `- ${operation} · HTTP ${status} · ${Math.ceil(delayMs / 1000)} s wait · retry ${attempt}/3`;
}

export function formatPublishedUpgradeSummary(target, report) {
  assert.ok(Object.hasOwn(targets, target));
  const lines = [`### Live updater · ${target}`, ''];
  if (!report) return [...lines, 'No native test report was produced.', ''].join('\n');
  assert.equal(report.target, target);

  const result = report.complete ? 'Passed' : report.finishedAt ? 'Failed' : 'Incomplete';
  const retries = report.rateLimitRetries;
  lines.push(
    `**Result** ${result} · ${report.checks.length} checks passed`,
    '',
    `**Versions tested** ${versionText(report.originalRuntime?.version)} → ${versionText(report.currentRuntime?.version)}`,
  );
  if (!report.currentRuntime && report.to)
    lines.push('', `**Selected upgrade** ${versionText(report.to)}`);
  lines.push(
    '',
    '| SHA-256 check | Result | Expected digest |',
    '| --- | --- | --- |',
    ...Object.entries(checksumLabels).map(([key, label]) =>
      checksumRow(label, report.checksums?.[key]),
    ),
    '',
    `**GitHub API rate-limit retries** ${retries?.length ?? 'Not recorded'}`,
  );
  if (retries?.length) lines.push('', ...retries.map(retryLine));
  return [...lines, ''].join('\n');
}

if (import.meta.main) {
  process.stdin.setEncoding('utf8');
  let json = '';
  for await (const chunk of process.stdin) json += chunk;
  process.stdout.write(
    formatPublishedUpgradeSummary(
      process.env.EXPECTED_TARGET,
      json.trim() ? JSON.parse(json) : null,
    ),
  );
}
