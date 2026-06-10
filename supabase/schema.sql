-- ============================================================
--  CineLog — Supabase(Postgres) 스키마
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
--  (auth.users 는 Supabase Auth가 관리하므로 직접 만들지 않습니다)
-- ============================================================

-- ── 1) 프로필 (auth.users 1:1 확장) ─────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  bio         text default '',
  avatar      text,
  is_admin    boolean default false,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- ── 2) 리뷰 ────────────────────────────────────────────────
create table if not exists public.reviews (
  id           bigint generated always as identity primary key,
  movie_id     text not null,
  movie_title  text,
  movie_poster text,
  movie_genre  text,
  movie_year   text,
  media_type   text default 'movie',
  author_id    uuid references public.profiles(id) on delete cascade,
  rating       int check (rating between 1 and 5),
  content      text,
  status       text check (status in ('watched','watching','want')),
  likes        int default 0,
  views        int default 0,
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists reviews_author_idx on public.reviews(author_id);
create index if not exists reviews_created_idx on public.reviews(created_at desc);

-- ── 3) 댓글 ────────────────────────────────────────────────
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  review_id   bigint references public.reviews(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete cascade,
  content     text,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists comments_review_idx on public.comments(review_id);

-- ── 4) 좋아요 (조인 테이블) ─────────────────────────────────
create table if not exists public.review_likes (
  review_id  bigint references public.reviews(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  primary key (review_id, user_id)
);

-- ============================================================
--  신규 가입 시 profiles 자동 생성 트리거
--  (이메일 가입 시 username 은 회원가입 폼에서 metadata 로 전달,
--   소셜 로그인 시 이메일/이름 기반으로 자동 생성 + uid 일부로 중복 방지)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  base_name text;
  final_name text;
begin
  -- 닉네임 우선순위: 이메일가입 시 고른 username > 소셜 제공 이름/닉네임 > 이메일 앞부분
  base_name := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'nickname', ''),
    nullif(new.raw_user_meta_data->>'user_name', ''),
    nullif(new.raw_user_meta_data->>'preferred_username', ''),
    split_part(coalesce(new.email, 'user'), '@', 1)
  );
  -- 닉네임 중복 시에만 uid 조각을 덧붙여 유일성 보장
  final_name := base_name;
  if exists (select 1 from public.profiles where username = final_name) then
    final_name := base_name || '_' || substr(new.id::text, 1, 4);
  end if;

  insert into public.profiles (id, username)
  values (new.id, final_name)
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 보안: SECURITY DEFINER 함수의 직접 실행 권한 회수 (트리거 실행엔 영향 없음)
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============================================================
--  RLS (Row Level Security)
--  서버는 service_role 키로 접근하므로 정책을 우회합니다.
--  아래 정책은 혹시 anon 키로 직접 접근하는 경우를 위한 방어선입니다.
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.reviews       enable row level security;
alter table public.comments      enable row level security;
alter table public.review_likes  enable row level security;

-- 공개 읽기
create policy "public read profiles" on public.profiles for select using (true);
create policy "public read reviews"  on public.reviews  for select using (true);
create policy "public read comments" on public.comments for select using (true);
create policy "public read likes"    on public.review_likes for select using (true);

-- 본인 데이터만 쓰기/수정
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id);
create policy "own review write" on public.reviews
  for all using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "own comment write" on public.comments
  for all using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "own like write" on public.review_likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
--  아바타 이미지용 Storage 버킷
--  (대시보드 > Storage 에서 만들어도 되지만 SQL로도 가능)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 아바타 버킷: 공개 읽기 + 로그인 사용자 업로드
create policy "avatar public read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatar auth upload" on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');
create policy "avatar auth update" on storage.objects
  for update using (bucket_id = 'avatars' and auth.role() = 'authenticated');
