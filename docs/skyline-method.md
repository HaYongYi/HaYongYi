# 스카이라인 분석 방법 (보고서용 메모)

## 배경

Karimimoshaver & Derakhshan (2026, *City and Environment Interactions* 30, 100380)은 고층건물 스카이라인의 지각을 **물리적 형태 → 시각·미적 지각 → 의미 해석**의 3단계로 모형화하고, 테헤란 4개 지구 주민과 전문가 168명의 설문으로 검증했다. 결론에서 저자들은 후속 연구로 3D 도시 모델·LiDAR·GIS 가시권 분석을 써서 **가시성, 스카이라인 정합, 건물 높이가 자연·인공 경관에 미치는 영향**을 정량화할 것을 제안한다. 이 프로젝트의 스카이라인 분석 레이어는 그 제안을 서울 도심 3D 모델(브이월드 건물 외곽선 + 90 m DEM)에 적용한 것이다. 설문은 수행하지 않았으므로, 결과는 물리·시각 층위의 측정값이며 의미 층위의 해석은 논문의 결과를 근거로 제시한다.

## 입력

- 건물: 브이월드 `lt_c_spbd` 외곽선, 높이 = 지상층수 × 3.3 m (층수 없으면 10 m)
- 지형: 국토지리정보원 90 m DEM(EPSG:5186)을 도시 좌표계로 변환
- 시점: 사용자가 지면을 클릭해 지정, 눈높이 = 지면 고도 + 1.6 m

## 계산

시점을 중심으로 방위를 1° 간격 360구간으로 나눈다.

1. **지형선** — 각 방위로 12 km까지 45 m 간격으로 DEM을 샘플링하고, 가장 가파른 앙각을 그 방위의 지형선으로 한다.
2. **건물선** — 반경 4 km 안의 모든 지상 건물에 대해, 외곽 상자의 네 모서리가 차지하는 방위 폭과 상자의 최근접점에서 본 건물 상단 앙각을 구해, 해당 방위 구간에 최대 앙각으로 기록한다. 가까운 건물이 먼 건물을 가리는 효과는 구간별 최대값으로 자연히 반영된다.
3. **스카이라인** — 구간별 max(지형선, 건물선).

## 지표와 논문 변수의 대응

| 지표 | 정의 | 논문의 변수 |
| --- | --- | --- |
| 건물 스카이라인 비율 | 건물선 > 지형선인 방위의 비율 | Skyline integration, Crossing the mountain line |
| 자연 조망 차폐 | 지형선 ≥ 1°인 방위 중 건물이 그 위로 솟는 비율 | Blocking natural city views (Table 6, p = 0.002) |
| 실루엣 봉우리 수 | 스카이라인 국소 최대(돌출 ≥ 0.5°) 개수 | Silhouette complexity |
| 실루엣 거칠기 | 이웃 구간 간 스카이라인 각변화의 평균 | Silhouette complexity |
| 하늘 개방도 | (90° − 스카이라인 앙각)/90°의 평균 | Width of visual corridor |
| 지배 건물 | 최대 앙각을 만드는 건물 | Visual dominance |
| 능선 돌파 구간 | 건물선 > 지형선인 연속 구간 수; 폭 ≤ 3°는 단독, 그보다 넓으면 군집 | Solitary / Clustered |

## 한계

- 건물은 외곽 상자로 근사하므로 L자형 등 복잡한 평면은 방위 폭이 약간 과대 평가된다.
- 90 m DEM이라 가까운 소규모 지형은 지형선에 나타나지 않는다. 지구 곡률(12 km에서 약 11 m)은 무시했다.
- 높이는 층수 추정값이다. 옥탑·첨탑·정상부 형태(논문의 crown)는 데이터에 없어 다루지 않는다.
- 지각·의미 차원(아름다움, 권력, 밀집감 등)은 측정하지 않았다. 논문의 결과(예: 산 능선을 넘는 건물에 대한 부정적 평가, 군집 배치의 밀집감)를 인용해 해석의 방향만 제시한다.

## 함께 참고할 최근 문헌 (논문 1의 참고문헌 중 4년 이내)

- Fan Z., Fujiwara K., Liu Z., Zhang F., Biljecki F. (2025). Image-based Visibility Analysis Replacing Line-of-Sight Simulation: An Urban Landmark Perspective. *Buildings*.
- Kaya Y. (2024). Automated Estimation of Building Heights with ICESat-2 and GEDI LiDAR Altimeter and Building Footprints: NYC and LA. *Buildings* 14(11), 3571.
- Yang L., Yang X., Li S. (2024). A new quantitative evaluation method of urban skyline based on object-based analysis and constitution theory. *Environ. Res. Public Health*.
- Zhang L., Zhang M., Yuan M., Guo Y. (2024). Regional evolution of the Hefei skyline based on exploratory factor analysis and semantic segmentation. *Buildings* 14, 1238.
