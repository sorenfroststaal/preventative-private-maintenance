import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export async function writeOutput(directory: string, filename: string, data: string | Uint8Array) {
  const original = join(directory, filename);
  try {
    await writeFile(original, data, { flag: 'wx' });
    return original;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const extension = extname(filename);
  const path = join(directory, filename.slice(0, -extension.length) + '-' + crypto.randomUUID() + extension);
  await writeFile(path, data, { flag: 'wx' });
  return path;
}
