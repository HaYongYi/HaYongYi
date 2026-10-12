# City Model Viewer

Next.js + Three.js + Supabase 기반의 웹 도시 모델 가시화 앱입니다. 건물 매스(footprint + 높이)를 3D로 렌더링하고, 마우스로 궤도 회전/확대하며, 건물을 클릭하면 속성을 볼 수 있습니다. Vercel에 바로 배포할 수 있습니다.

## 기능

- Three.js 기반 3D 도시 뷰 (그림자, 안개, 지면 그리드)
- 건물 호버 하이라이트 및 클릭 선택 → 용도/높이/footprint/위치 패널
- 드래그와 클릭을 구분하므로 카메라 회전 중 실수로 선택되지 않음
- Supabase `buildings` 테이블에서 데이터 로드 (서버 컴포넌트, 요청마다 최신 데이터)
- Supabase 미설정 시 결정적(seeded) 샘플 도시로 자동 대체 → 클론 직후 바로 실행 가능

## 기술 스택

| 영역 | 사용 |
| --- | --- |
| 프레임워크 | Next.js 16 (App Router), React 19, TypeScript |
| 3D | Three.js (OrbitControls, Raycaster) |
| 데이터 | Supabase (Postgres + RLS, `@supabase/supabase-js`) |
| 배포 | Vercel |

## 프로젝트 구조

```
app/
  layout.tsx        루트 레이아웃, 메타데이터
  page.tsx          서버 컴포넌트: 도시 데이터 로드 후 뷰어 렌더링
  globals.css       테마(라이트/다크) 및 레이아웃
  icon.svg          파비콘
components/
  CityViewer.tsx    Three.js 씬 (클라이언트 컴포넌트)
lib/
  types.ts          Building 타입
  supabase.ts       Supabase 클라이언트 및 loadCity()
  sample-city.ts    샘플 도시 생성기
supabase/
  schema.sql        buildings 테이블, RLS 정책
```

## 데이터 모델

`buildings` 테이블의 각 행은 미터 단위 직사각형 건물입니다. 좌표계는 지면 평면이며 `x`는 동쪽, `z`는 남쪽 방향입니다. 자세한 정의는 [`supabase/schema.sql`](supabase/schema.sql)을 참고하세요.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | text (PK) | 건물 식별자 |
| `name` | text | 표시 이름 |
| `usage` | text | 용도 (예: `office`, `residential`, `park`) |
| `x`, `z` | float | footprint 중심 좌표 (m) |
| `width`, `depth` | float | footprint 크기 (m) |
| `height` | float | 높이 (m) |
| `color` | text | `#RRGGBB` |

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # Supabase를 쓰지 않으면 생략 가능 (샘플 도시로 실행)
npm run dev                  # http://localhost:3000
```

스크립트:

- `npm run dev` — 개발 서버
- `npm run build` — 프로덕션 빌드
- `npm run start` — 빌드 결과 실행
- `npm run typecheck` — 타입 검사

## Supabase 설정

1. Supabase 프로젝트를 만듭니다.
2. SQL 편집기에서 [`supabase/schema.sql`](supabase/schema.sql)을 실행합니다.
3. 데이터를 넣습니다. `buildings` 테이블에 행을 추가하면 새로고침 시 바로 반영됩니다. 쓰기 권한은 anon 키에 부여하지 않았으므로, 대량 적재는 SQL 편집기 또는 service role 키를 사용하는 신뢰된 환경에서 수행하세요. service role 키는 브라우저에 노출하면 안 됩니다.
4. 프로젝트 설정 → API 에서 **Project URL**과 **anon public key**를 `.env.local`에 넣습니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

환경변수가 없거나 쿼리가 실패하면 샘플 도시로 대체되며, 헤더의 "data source"에 현재 출처가 표시됩니다.

## 서울 데이터 가져오기 (브이월드)

[브이월드(VWorld)](https://www.vworld.kr) 건물 레이어(`lt_c_spbd`)의 실제 외곽선으로 서울 도시를 만들 수 있습니다. 가져오기는 PC에서 실행합니다.

1. 브이월드에서 Open API 키를 발급받습니다.
2. 프로젝트 루트에서 실행합니다. 기본 범위는 서울시청 주변입니다.

   ```bash
   # macOS / Linux
   VWORLD_API_KEY=발급받은키 npm run import:seoul

   # Windows PowerShell
   $env:VWORLD_API_KEY="발급받은키"; npm run import:seoul
   ```

3. 범위를 바꾸려면 `BBOX="minLon,minLat,maxLon,maxLat"`을 지정합니다. 예: `BBOX="126.975,37.555,126.995,37.575"`.
4. `supabase/seed-seoul.sql`이 생성되면 Supabase SQL 편집기에 붙여넣어 실행합니다. 재실행해도 같은 `id`는 덮어쓰기 됩니다.

**높이 계산.** 건물 레이어에는 높이 속성이 없어서, 지상층수(`gro_flo_co`) × 층고(기본 3.3m)로 높이를 추정합니다. 층수가 없는 건물은 10m를 씁니다. 층고는 `FLOOR_HEIGHT`로 바꿀 수 있습니다. 지하층수는 높이에 반영하지 않습니다.

**확인이 필요한 항목.** 스크립트의 속성명(`FLOORS_FIELD`, `ID_FIELD`, `NAME_FIELD`)은 기본값입니다. 실제 레이어 스키마와 다르면 임의 이름이나 기본 높이가 들어갑니다. 큰 가져오기 전에 아래 URL로 스키마를 확인하고, 필요하면 환경변수로 덮어쓰세요.

```
https://api.vworld.kr/req/wfs?service=WFS&version=1.1.0&request=DescribeFeatureType&typename=lt_c_spbd&key=발급받은키
```

**범위와 개수.** 기본 범위는 중구·종로 일대(약 6km × 5km)입니다. 가져오기는 요청 한도(1000개)를 넘으면 자동으로 4등분해서 여러 번 요청하고, 중복을 제거해서 합칩니다. 건물이 2000개를 넘으면 `supabase/seed-seoul-001.sql`, `-002.sql`처럼 나눠서 저장됩니다. 파일을 순서대로 하나씩 SQL 편집기에 실행하세요. 범위를 더 넓히려면 `BBOX`를 지정합니다. 건물이 많을수록 화면이 무거워지므로, 넓은 범위는 한 번에 올리기 전에 먼저 작은 범위로 확인하는 것을 권장합니다. 가져온 건물이 수천 개를 넘으면 렌더링 부담이 커지므로 `InstancedMesh` 전환을 검토하세요.

## 서울 도로 가져오기 (브이월드)

도로 중심선(`lt_l_n3a0020000`)을 `roads` 표에 넣습니다. 건물과 별도 레이어로 관리하므로 건물 데이터를 다시 가져올 필요가 없습니다.

1. `supabase/schema.sql`을 한 번 실행해서 `roads` 표를 만듭니다. (이미 실행했다면 생략)
2. 건물 가져오기와 같은 키로 실행합니다.

   ```powershell
   $env:VWORLD_API_KEY="발급받은키"
   $env:VWORLD_DOMAIN="https://hayongyi-env-webcity.vercel.app"
   npm run import:roads
   ```

3. 생성된 `supabase/seed-roads.sql`을 Supabase SQL 편집기에서 실행합니다.

도로폭은 `rvwd` 속성을 쓰고, 값이 없으면 8m로 그립니다. 도로가 아직 없어도 건물은 정상적으로 표시됩니다.

## Vercel 배포

1. 이 저장소를 Vercel에 Import 합니다. Framework는 Next.js로 자동 감지됩니다.
2. Project Settings → Environment Variables 에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 추가합니다.
3. Deploy 합니다.

페이지는 `force-dynamic`으로 요청마다 Supabase를 조회하므로, 데이터를 바꿔도 재배포가 필요 없습니다.

## 알려진 제약과 다음 단계

- 건물 외곽선은 `footprint`(다각형)가 있으면 `ExtrudeGeometry`로, 없으면 직사각형 박스로 그립니다. 공원·도로 등 건물이 아닌 레이어는 아직 없습니다.
- 건물마다 메쉬를 만들기 때문에 수천 개 이상에서는 `InstancedMesh`로 바꾸는 것을 권장합니다.
- 좌표계는 미터 단위의 로컬 평면입니다. 지리 좌표(위경도)를 쓰려면 투영 변환 단계가 필요합니다.
