/**
 * Upserts rows straight into Supabase through the REST API, so the SQL editor
 * is not needed. Requires the service role key, which bypasses row-level security.
 * Keep that key in your local environment only; never commit it or expose it to the browser.
 */

/** True when UPLOAD=1 is set. Throws early if the URL or service key is missing. */
export function uploadRequested(env) {
  if (env.UPLOAD !== '1') return false;
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'UPLOAD=1 needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.',
    );
  }
  return true;
}

/**
 * @param {object} env                 process.env
 * @param {string} table               e.g. buildings
 * @param {object[]} rows              rows with snake_case keys matching the table
 * @param {number} [batchSize=500]
 */
export async function upsertRows(env, table, rows, batchSize = 500) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const url = `${base}/rest/v1/${table}?on_conflict=id`;

  let sent = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload to ${table} failed at row ${start} (HTTP ${response.status}): ${text.slice(0, 400)}`);
    }
    sent += batch.length;
    console.log(`  ${table}: ${sent}/${rows.length}`);
  }
  return sent;
}
