import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = [
  'apps/web/components',
  'apps/web/app/(dashboard)/dashboard',
  'packages/ui/src/components',
  'packages/validations/src',
  'packages/types/src',
  'packages/utils/src/pricing',
  'packages/db/src',
];

const exts = new Set(['.ts', '.tsx', '.css', '.sql']);

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, out);
      continue;
    }

    if (!exts.has(path.extname(fullPath))) {
      continue;
    }

    out.push(fullPath);
  }

  return out;
}

function hashFile(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha1').update(content).digest('hex');
}

const files = roots.flatMap((dir) => walk(dir));
const byHash = new Map();

for (const file of files) {
  const hash = hashFile(file);
  const list = byHash.get(hash) ?? [];
  list.push(file);
  byHash.set(hash, list);
}

const duplicates = [...byHash.values()].filter((group) => group.length > 1);

if (duplicates.length > 0) {
  console.error('Duplicate file content detected across canonical source areas:');
  for (const group of duplicates) {
    console.error(`\n- ${group.join('\n  ')}`);
  }
  process.exit(1);
}

console.log(`No duplicate file content found across ${files.length} files.`);
