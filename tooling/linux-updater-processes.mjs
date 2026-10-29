import { basename } from 'node:path';

export function parseLinuxProcessStat(pid, value, executable) {
  const end = value.lastIndexOf(')');
  const fields = value.slice(end + 2).split(' ');
  return {
    pid,
    parent: Number(fields[1]),
    start: fields[19],
    name: value.slice(value.indexOf('(') + 1, end),
    executable,
  };
}

export function ownedImageDescendants(records, image) {
  const owned = new Set(
    records
      .filter((record) => record.executable === image || record.executable === image + ' (deleted)')
      .map((record) => record.pid),
  );
  let count;
  do {
    count = owned.size;
    for (const record of records) if (owned.has(record.parent)) owned.add(record.pid);
  } while (owned.size !== count);
  return records.filter((record) => owned.has(record.pid));
}

export function findImageDesktop(records, image) {
  for (const record of records) {
    const mainExecutable = record.executable
      ? basename(record.executable) === 'gleech-bin'
      : /^(?:gleech(?:-bin)?|GLEECH)$/.test(record.name ?? '');
    if (!mainExecutable) continue;
    const launcher = records.find((value) => value.pid === record.parent);
    if (launcher?.executable === image) return { ...record, launcher };
  }
  return null;
}
