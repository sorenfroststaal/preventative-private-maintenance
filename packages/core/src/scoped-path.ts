import { isAbsolute, relative, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

export async function insideArchive(root: string, path: string) {
  const [base, resolved] = await Promise.all([realpath(root), realpath(path)]);
  const location = relative(base, resolved);
  if (isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) {
    throw new Error('Stien ligger uden for arkivet.');
  }
  return resolved;
}
