'use client';

import type { SkylineMetrics } from '@/lib/skyline';
import type { NamedViewpoint } from '@/lib/viewpoints';

export interface ViewpointRow {
  viewpoint: NamedViewpoint;
  metrics: SkylineMetrics;
  dominantName: string;
}

interface ViewpointTableProps {
  rows: ViewpointRow[];
  onPick: (viewpoint: NamedViewpoint) => void;
  onClose: () => void;
}

const COLUMNS: { label: string; unit: string; value: (r: ViewpointRow) => string }[] = [
  { label: '건물 스카이라인', unit: '%', value: (r) => (r.metrics.buildingSkylineShare * 100).toFixed(0) },
  { label: '자연 조망 차폐', unit: '%', value: (r) => (r.metrics.naturalViewObstruction * 100).toFixed(0) },
  { label: '봉우리', unit: '개', value: (r) => String(r.metrics.peaks) },
  { label: '거칠기', unit: '°/bin', value: (r) => r.metrics.roughness.toFixed(2) },
  { label: '하늘 개방도', unit: '%', value: (r) => (r.metrics.skyOpenness * 100).toFixed(0) },
  { label: '최대 앙각', unit: '°', value: (r) => r.metrics.dominantAngle.toFixed(1) },
  { label: '지배 건물', unit: '', value: (r) => r.dominantName },
  { label: '돌파 구간', unit: '개', value: (r) => String(r.metrics.intrusionRuns) },
  { label: '단독/군집', unit: '', value: (r) => `${r.metrics.solitaryRuns}/${r.metrics.clusteredRuns}` },
  { label: '가시 건물', unit: '동', value: (r) => String(r.metrics.visibleCount) },
  { label: '돌파 건물', unit: '동', value: (r) => String(r.metrics.intrudingCount) },
];

function toCsv(rows: ViewpointRow[]): string {
  const header = ['viewpoint', 'lon', 'lat', ...COLUMNS.map((c) => (c.unit ? `${c.label}(${c.unit})` : c.label))];
  const lines = rows.map((r) =>
    [r.viewpoint.name, r.viewpoint.lon, r.viewpoint.lat, ...COLUMNS.map((c) => c.value(r))]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/** Metrics of every named viewpoint side by side, with a CSV export for the report. */
export default function ViewpointTable({ rows, onPick, onClose }: ViewpointTableProps) {
  const download = () => {
    // BOM so Excel on Windows reads the Korean headers as UTF-8
    const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skyline-viewpoints-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="viewpoint-table" aria-label="대표 시점 비교">
      <header>
        <h2>대표 시점 비교</h2>
        <button type="button" onClick={download}>
          CSV 내보내기
        </button>
        <button type="button" onClick={onClose} aria-label="닫기" className="close">
          ×
        </button>
      </header>
      <div className="viewpoint-scroll">
        <table>
          <thead>
            <tr>
              <th>시점</th>
              {COLUMNS.map((c) => (
                <th key={c.label}>
                  {c.label}
                  {c.unit && <span className="unit"> ({c.unit})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.viewpoint.key} onClick={() => onPick(r.viewpoint)} title="클릭하면 이 시점을 화면에 표시합니다">
                <th scope="row">{r.viewpoint.name}</th>
                {COLUMNS.map((c) => (
                  <td key={c.label}>{c.value(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
