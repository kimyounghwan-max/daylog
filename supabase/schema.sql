-- =====================================================================
-- 하루의 기록: Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run 하세요.
-- ⚠️ 아래 is_owner() 안의 이메일을 내 이메일로 꼭 바꾸세요.
-- =====================================================================

-- 0) 주인 확인 함수: 이 이메일로 로그인한 사람만 쓰기/수정/삭제 가능
create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'YOUR_EMAIL@example.com'
$$;

-- 1) 기록 (책, 영화, 음악, 여행, 데이트, 운동)
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category    text not null check (category in ('book','movie','music','travel','date','workout')),
  title       text not null,
  content     text default '',
  rating      smallint check (rating between 1 and 5),
  entry_date  date not null default current_date,
  tags        text[] not null default '{}',
  meta        jsonb not null default '{}'::jsonb,   -- 저자, 감독, 장소, 운동 시간 같은 종류별 정보
  image_url   text,
  is_private  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists entries_date_idx on public.entries (entry_date desc);
create index if not exists entries_category_idx on public.entries (category);

alter table public.entries enable row level security;

drop policy if exists "공개 기록은 누구나 읽기" on public.entries;
create policy "공개 기록은 누구나 읽기" on public.entries
  for select using (is_private = false or public.is_owner());

drop policy if exists "주인만 쓰기" on public.entries;
create policy "주인만 쓰기" on public.entries
  for insert to authenticated with check (public.is_owner() and user_id = auth.uid());

drop policy if exists "주인만 고치기" on public.entries;
create policy "주인만 고치기" on public.entries
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "주인만 지우기" on public.entries;
create policy "주인만 지우기" on public.entries
  for delete to authenticated using (public.is_owner());

-- 2) 담아둔 추천 (주인만 볼 수 있음)
create table if not exists public.recommendations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category    text not null check (category in ('book','movie','music','hobby')),
  title       text not null,
  creator     text default '',
  reason      text default '',
  note        text default '',
  status      text not null default 'saved' check (status in ('saved','done')),
  created_at  timestamptz not null default now()
);

alter table public.recommendations enable row level security;

drop policy if exists "주인만 추천 관리" on public.recommendations;
create policy "주인만 추천 관리" on public.recommendations
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- 3) 사진 저장소 (공개 읽기, 주인만 올리기/지우기)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "주인만 사진 올리기" on storage.objects;
create policy "주인만 사진 올리기" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.is_owner());

drop policy if exists "주인만 사진 지우기" on storage.objects;
create policy "주인만 사진 지우기" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.is_owner());
