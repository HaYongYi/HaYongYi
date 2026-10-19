import CityViewer from '@/components/CityViewer';
import { loadCity } from '@/lib/supabase';
import { loadCongestion } from '@/lib/citydata';

// Read Supabase and the live city data on each request so changes show up without a redeploy.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const [{ buildings, roads, source }, congestion] = await Promise.all([loadCity(), loadCongestion()]);

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>City Model Viewer</h1>
          <p className="meta">
            {buildings.length.toLocaleString()} buildings · {roads.length.toLocaleString()} roads · data source:{' '}
            {source === 'supabase' ? 'Supabase' : 'sample city'}
            {congestion.length > 0 && ` · live crowd: ${congestion.length} areas`}
          </p>
        </div>
        <p className="hint">Drag to orbit · scroll to zoom · click a building for details</p>
      </header>
      <CityViewer buildings={buildings} roads={roads} congestion={congestion} />
    </main>
  );
}
