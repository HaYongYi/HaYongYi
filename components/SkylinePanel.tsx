'use client';

import { AZIMUTH_BINS, type SkylineResult } from '@/lib/skyline';

interface SkylinePanelProps {
  result: SkylineResult;
  buildingName: (id: string | null) => string;
  onClose: () => void;
}

const WIDTH = 720;
const HEIGHT = 150;
const PAD_LEFT = 28;
const PAD_BOTTOM = 18;
const PAD_TOP = 8;
const MIN_TOP_ANGLE = 20;

/** Unrolled 360° silhouette: terrain in green, buildings in gray, intrusions in red. */
export default function SkylinePanel({ result, buildingName, onClose }: SkylinePanelProps) {
  const { bins, metrics } = result;
  const plotW = WIDTH - PAD_LEFT - 4;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxAngle = Math.max(MIN_TOP_ANGLE, ...bins.map((b) => Math.max(b.terrain, b.building)));
  const x = (i: number) => PAD_LEFT + (i / AZIMUTH_BINS) * plotW;
  const y = (angle: number) => PAD_TOP + plotH - (Math.max(angle, 0) / maxAngle) * plotH;
  const baseline = y(0);

  const polygon = (pick: (i: number) => number) => {
    const points = bins.map((_, i) => `${x(i).toFixed(1)},${y(pick(i)).toFixed(1)}`);
    return `${x(0).toFixed(1)},${baseline} ${points.join(' ')} ${x(AZIMUTH_BINS).toFixed(1)},${baseline}`;
  };

  // Red strokes over directions where a building rises above the terrain line
  const intrusionSegments: string[] = [];
  let current: string[] = [];
  bins.forEach((b, i) => {
    if (b.building > b.terrain && b.buildingId) {
      current.push(`${x(i).toFixed(1)},${y(b.building).toFixed(1)}`);
    } else if (current.length > 0) {
      intrusionSegments.push(current.join(' '));
      current = [];
    }
  });
  if (current.length > 0) intrusionSegments.push(current.join(' '));

  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <section className="skyline-panel" aria-label="스카이라인 분석">
      <header>
        <h2>스카이라인 분석</h2>
        <span className="skyline-sub">
          시점 x {result.viewpoint[0].toFixed(0)}, z {result.viewpoint[1].toFixed(0)} · 눈높이 {result.eyeY.toFixed(1)} m
        </span>
        <button type="button" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </header>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="skyline-svg" role="img" aria-label="360도 실루엣">
        <polygon points={polygon((i) => bins[i].terrain)} className="skyline-terrain" />
        <polygon points={polygon((i) => bins[i].building)} className="skyline-buildings" />
        {intrusionSegments.map((points, i) => (
          <polyline key={i} points={points} className="skyline-intrusion" />
        ))}
        {[0, 90, 180, 270].map((deg, i) => (
          <g key={deg}>
            <line x1={x(deg)} x2={x(deg)} y1={PAD_TOP} y2={baseline} className="skyline-grid" />
            <text x={x(deg)} y={HEIGHT - 4} className="skyline-label" textAnchor="middle">
              {['N', 'E', 'S', 'W'][i]}
            </text>
          </g>
        ))}
        <text x={PAD_LEFT - 4} y={PAD_TOP + 10} className="skyline-label" textAnchor="end">
          {maxAngle.toFixed(0)}°
        </text>
        <text x={PAD_LEFT - 4} y={baseline} className="skyline-label" textAnchor="end">
          0°
        </text>
      </svg>
      <dl className="skyline-metrics">
        <dt>건물 스카이라인 비율</dt>
        <dd>{pct(metrics.buildingSkylineShare)}</dd>
        <dt>자연 조망 차폐</dt>
        <dd>{pct(metrics.naturalViewObstruction)}</dd>
        <dt>실루엣 봉우리</dt>
        <dd>{metrics.peaks}개</dd>
        <dt>실루엣 거칠기</dt>
        <dd>{metrics.roughness.toFixed(2)}°/bin</dd>
        <dt>하늘 개방도</dt>
        <dd>{pct(metrics.skyOpenness)}</dd>
        <dt>지배 건물</dt>
        <dd>
          {buildingName(metrics.dominantBuildingId)} ({metrics.dominantAngle.toFixed(1)}°)
        </dd>
        <dt>능선 돌파 구간</dt>
        <dd>
          {metrics.intrusionRuns}개 (단독 {metrics.solitaryRuns} · 군집 {metrics.clusteredRuns})
        </dd>
        <dt>가시 / 돌파 건물</dt>
        <dd>
          {metrics.visibleCount.toLocaleString()} / {metrics.intrudingCount.toLocaleString()}
        </dd>
      </dl>
    </section>
  );
}
