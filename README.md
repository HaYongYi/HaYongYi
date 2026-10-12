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

## Vercel 배포

1. 이 저장소를 Vercel에 Import 합니다. Framework는 Next.js로 자동 감지됩니다.
2. Project Settings → Environment Variables 에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 추가합니다.
3. Deploy 합니다.

페이지는 `force-dynamic`으로 요청마다 Supabase를 조회하므로, 데이터를 바꿔도 재배포가 필요 없습니다.

## 알려진 제약과 다음 단계

- 현재 건물은 직사각형 footprint만 지원합니다. 실제 도시 모델(GeoJSON, CityGML 등)의 임의 다각형 footprint는 `Building`에 폴리곤 필드를 추가하고 `THREE.Shape` + `ExtrudeGeometry`로 확장하는 것이 자연스럽습니다.
- 건물 수가 수천 개를 넘으면 머티리얼/메쉬를 건물마다 만드는 대신 `InstancedMesh`로 바꾸는 것을 권장합니다.
- 좌표계는 미터 단위의 로컬 평면입니다. 지리 좌표(위경도)를 쓰려면 투영 변환 단계가 필요합니다.
