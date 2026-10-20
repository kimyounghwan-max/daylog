# 하루의 기록

책, 영화, 음악, 여행, 데이트, 운동을 기록하고, 그 기록으로 새로운 책·영화·음악·취미를 추천받는 개인 홈페이지.

- 화면: GitHub Pages (빌드 과정 없는 HTML/CSS/JS)
- 데이터, 사진, 로그인: Supabase
- 추천: Supabase Edge Function → Claude API

```
daylog/
├─ index.html
├─ css/style.css
├─ js/config.js        ← Supabase 주소와 키를 넣는 곳
├─ js/data.js          ← 저장소 (Supabase / 데모)
├─ js/app.js           ← 화면과 동작
└─ supabase/
   ├─ schema.sql                    ← 테이블, 보안 정책, 사진 버킷
   └─ functions/recommend/index.ts  ← 추천 함수
```

## 0. 먼저 구경하기

`index.html`을 더블클릭해서 브라우저로 열면 **데모 모드**로 동작해요. 샘플 기록이 들어 있고, 쓰고 고친 내용은 그 브라우저에만 저장돼요.

## 1. Supabase 준비

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만들어요.
2. **SQL Editor**를 열고 `supabase/schema.sql` 내용을 붙여 넣어요.
   **`YOUR_EMAIL@example.com`을 내 이메일로 바꾼 뒤** Run 하세요. 이 이메일로 로그인한 사람만 글을 쓸 수 있어요.
3. **Authentication → Users → Add user**에서 같은 이메일과 비밀번호로 계정을 만들어요. (Auto Confirm 체크)
4. **Authentication → Sign In / Providers**에서 "Allow new users to sign up"을 꺼 두면 다른 사람이 가입할 수 없어요.
5. **Project Settings → API**에서 Project URL과 anon(또는 publishable) key를 복사해 `js/config.js`에 넣어요.

```js
SUPABASE_URL: 'https://abcdefgh.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

> anon 키는 공개돼도 괜찮아요. 실제 보호는 RLS 정책이 해요. service_role 키와 Anthropic API 키는 절대 `config.js`에 넣지 마세요.

## 2. 추천 함수 배포

[console.anthropic.com](https://console.anthropic.com)에서 API 키를 발급받아요 (사용량만큼 요금이 나와요).

**방법 A: 대시보드에서 (설치 없이)**

1. **Edge Functions → Deploy a new function → Via Editor**, 이름은 `recommend`.
2. `supabase/functions/recommend/index.ts` 내용을 붙여 넣고 Deploy.
3. 함수 설정에서 **Verify JWT를 꺼요**. (함수가 직접 주인 계정인지 확인해요)
4. **Edge Functions → Secrets**에 두 개를 추가해요.
   - `ANTHROPIC_API_KEY` = 발급받은 키
   - `OWNER_EMAIL` = schema.sql에 넣은 이메일

**방법 B: Supabase CLI로**

```bash
supabase login
supabase init                       # 처음 한 번 (config.toml 생성)
supabase link --project-ref <프로젝트-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... OWNER_EMAIL=me@example.com
supabase functions deploy recommend --no-verify-jwt
```

함수 안의 모델 이름(`MODEL`)은 [docs.claude.com](https://docs.claude.com)에서 최신 이름을 확인해 바꿀 수 있어요.

## 3. GitHub Pages 배포

```bash
git init
git add .
git commit -m "하루의 기록 시작"
git branch -M main
git remote add origin https://github.com/<내아이디>/<저장소이름>.git
git push -u origin main
```

GitHub 저장소 → **Settings → Pages** → Source를 "Deploy from a branch", 브랜치 `main`, 폴더 `/ (root)`로 저장하면 1~2분 뒤 `https://<내아이디>.github.io/<저장소이름>/`에서 열려요.

## 쓰는 법

- 사이트 맨 아래 **주인 로그인** → 로그인하면 오른쪽 위에 **기록하기** 버튼이 생겨요.
- **나만 보기**에 체크한 기록은 방문자에게 보이지 않아요.
- 맨 위 색 칸은 올해의 하루하루예요. 칸을 누르면 그날의 기록만 보여요.
- 태그를 꾸준히 달고 별점을 매길수록 **추천** 탭의 결과가 정확해져요. 추천은 기록이 3개 이상일 때부터 받을 수 있어요.
- 담아둔 추천을 "해봤어요"로 바꾸면, 책·영화·음악은 **기록하기**로 바로 감상을 남길 수 있어요.

## 문제가 생기면

| 증상 | 확인할 것 |
| --- | --- |
| 저장할 때 "row-level security" 오류 | schema.sql의 이메일과 로그인한 이메일이 같은지 |
| 사진 업로드 실패 | SQL을 끝까지 실행했는지 (photos 버킷과 정책) |
| 추천에서 401 | `OWNER_EMAIL` 시크릿, Verify JWT 꺼짐 여부 |
| 추천에서 502 | `ANTHROPIC_API_KEY`, 모델 이름, Anthropic 콘솔의 크레딧 |
| 바꾼 내용이 사이트에 안 보임 | GitHub Pages 반영까지 1~2분, 브라우저 강력 새로고침 |
