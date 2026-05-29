# Vercel 공유 저장소 설정

Supabase가 어렵다면 Upstash Redis를 쓰면 됩니다. SQL을 실행할 필요가 없습니다.

## 추천: Vercel Marketplace에서 Upstash Redis 연결

1. Vercel Dashboard에서 프로젝트로 들어갑니다.
2. `Storage` 또는 `Marketplace` 메뉴를 엽니다.
3. `Upstash Redis`를 선택합니다.
4. 현재 프로젝트에 연결합니다.
5. Vercel이 환경변수를 자동으로 추가했는지 확인합니다.

필요한 환경변수 이름은 둘 중 한 세트입니다.

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

또는

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

6. Vercel에서 다시 Deploy 합니다.
7. 배포 주소 뒤에 `/api/state`를 붙여서 JSON이 나오면 성공입니다.

```text
https://너의-vercel주소.vercel.app/api/state
```

## 참고

`api/state.js`는 Upstash Redis 환경변수가 있으면 Redis를 먼저 사용합니다.
없으면 예전에 만든 Supabase 환경변수를 fallback으로 시도합니다.
