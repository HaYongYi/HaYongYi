import CityViewer from '@/components/CityViewer';
import { loadCity } from '@/lib/supabase';

// Read Supabase on each request so new rows show up without a redeploy.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const { buildings, source } = await loadCity();

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>City Model Viewer</h1>
          <p className="meta">
            {buildings.length.toLocaleString()} buildings · data source: {source === 'supabase' ? 'Supabase' : 'sample city'}
          </p>
        </div>
        <p className="hint">Drag to orbit · scroll to zoom · click a building for details</p>
      </header>
      <CityViewer buildings={buildings} />
    </main>
  );
}
