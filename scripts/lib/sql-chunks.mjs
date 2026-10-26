import { writeFile } from 'node:fs/promises';

/**
 * Writes rows as one SQL file, or as several numbered files when there are more than
 * `rowsPerFile` rows. Large single files are slow to paste into the Supabase SQL editor.
 *
 *   seed-seoul.sql  ->  seed-seoul-001.sql, seed-seoul-002.sql, ...
 *
 * @param {string} outPath
 * @param {object[]} rows
 * @param {(chunk: object[]) => string} buildSql
 * @param {number} rowsPerFile
 * @returns {Promise<string[]>} the paths written
 */
export async function writeSqlChunks(outPath, rows, buildSql, rowsPerFile) {
  if (rows.length <= rowsPerFile) {
    await writeFile(outPath, buildSql(rows), 'utf8');
    return [outPath];
  }

  const base = outPath.replace(/\.sql$/, '');
  const written = [];
  for (let start = 0, part = 1; start < rows.length; start += rowsPerFile, part++) {
    const path = `${base}-${String(part).padStart(3, '0')}.sql`;
    await writeFile(path, buildSql(rows.slice(start, start + rowsPerFile)), 'utf8');
    written.push(path);
  }
  return written;
}
