# calendar-sync-server

캘린더 PWA의 안드로이드 ↔ 윈도우 동기화를 위한 최소한의 개인용 서버입니다.
DB 서버 없이 JSON 파일 하나(`data/events.json`)에 저장하고, 토큰 하나로 인증합니다.
여러 사용자를 위한 서비스가 아니라 **본인 전용 동기화 엔드포인트**입니다.

## 로컬에서 실행

```bash
cp .env.example .env
# .env를 열어 SYNC_TOKEN을 임의의 긴 문자열로 바꾸세요
# 예: openssl rand -hex 24

npm install
npm start
# http://localhost:3000/api/health 로 확인
```

## 배포 옵션

이 서버는 상태(JSON 파일)를 로컬 디스크에 저장하므로, **재배포/재시작 시에도 파일이 남는 영구 저장 공간**이 있는 곳에 올려야 합니다. 무료 플랜 중 상당수는 기본적으로 이게 없으니 아래 중 하나를 고르실 때 확인하세요.

### 1) Fly.io (볼륨 지원, 무료 티어 있음)
```bash
fly launch          # 이 폴더에서 실행, Dockerfile 자동 인식
fly volumes create calendar_data --size 1
# fly.toml에 아래 추가 후 재배포
#   [mounts]
#   source = "calendar_data"
#   destination = "/data"
fly secrets set SYNC_TOKEN=본인이_만든_토큰
fly deploy
```

### 2) Railway
- 새 프로젝트 → 이 폴더(GitHub 레포)를 연결 → Dockerfile 자동 인식
- Variables에 `SYNC_TOKEN` 추가
- Volume을 `/data`에 마운트하고 `DATA_DIR=/data` 환경변수 추가

### 3) 직접 가진 VPS
```bash
docker build -t calendar-sync .
docker run -d --name calendar-sync \
  -p 3000:3000 \
  -e SYNC_TOKEN=본인이_만든_토큰 \
  -v $(pwd)/data:/data \
  calendar-sync
```
앞단에 Caddy/Nginx로 HTTPS 리버스 프록시를 붙이는 걸 권장합니다 (토큰이 헤더로 오가므로 평문 HTTP는 피하세요).

## API

모든 요청(`/api/health` 제외)은 `Authorization: Bearer <SYNC_TOKEN>` 헤더가 필요합니다.

- `GET /api/health` — 상태 확인, 인증 불필요
- `GET /api/events?since=<ms>` — 해당 시각 이후 변경된 이벤트 전체 조회 (디버깅용)
- `POST /api/sync` — 실제 동기화에 사용
  - 요청: `{ "since": 1719999999999, "changes": [ {이벤트 객체...} ] }`
  - 응답: `{ "serverTime": ..., "events": [ ...since 이후 변경된 전체 이벤트... ] }`
  - 병합 규칙: 각 이벤트의 `updatedAt`이 더 큰 쪽이 항상 이깁니다 (last-write-wins). 삭제는 `deleted:true` 필드를 가진 이벤트로 전파됩니다.

## 앱 쪽 설정

PWA의 ⚙ 동기화 설정에 이 서버의 URL(`https://your-server.example.com`)과 `.env`에 넣은 토큰을 입력하면 됩니다.
