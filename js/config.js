// 사이트 설정
// SUPABASE_URL / SUPABASE_ANON_KEY 를 비워 두면 "데모 모드"로 동작해요.
// (데모 모드: 이 브라우저에만 저장되고, 샘플 기록이 미리 들어 있어요)
//
// anon(또는 publishable) 키는 공개돼도 괜찮은 키예요. 실제 보호는 schema.sql 의 RLS 정책이 담당합니다.
// 단, service_role 키나 Anthropic API 키는 절대 여기에 넣지 마세요.

window.APP_CONFIG = {
  SITE_TITLE: '하루의 기록',
  OWNER_NAME: '나',

  SUPABASE_URL: 'https://mtffldwfguxnbtiwjgnb.supabase.co',       // 예: 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10ZmZsZHdmZ3V4bmJ0aXdqZ25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NzgyNjksImV4cCI6MjEwODA1NDI2OX0.eRaIaIWpwC2rENzYUR_ldYqZizjgSiF7Er7c5gYkZ4I',  // Project Settings → API 에서 복사
};
