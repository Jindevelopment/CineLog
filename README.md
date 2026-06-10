<div align="center">
  <img src="logo.jpg" alt="CineLog" width="160" />

  # 🎬 CineLog

  **나만의 영화·드라마 기록 + AI 기반 검색·추천 서비스**

  영화를 보고 별점과 리뷰를 남기고, 다른 사람과 공유하고,
  "그 영화 뭐였지?"를 AI에게 물어 찾아내는 소셜 무비로그.
</div>

---

## 📖 소개

CineLog는 본 영화/드라마를 **기록(별점·리뷰·상태)** 하고, **TMDB의 방대한 작품 정보**로 검색하며,
**AI 챗봇**에게 줄거리를 묻거나 "기억나는 장면"으로 작품을 찾을 수 있는 웹 서비스입니다.

> 명지대학교 인터넷프로그래밍 기말 프로젝트로 시작해, 실제 배포가 가능한 구조(Supabase + Vercel)로 발전시킨 프로젝트입니다.

## ✨ 주요 기능

| 기능 | 설명 |
|---|---|
| 🔐 **회원 인증** | 이메일 회원가입(**메일 인증 필수**) · 로그인/로그아웃 + **Google·Kakao 소셜 로그인** |
| 👤 **프로필** | 닉네임 변경, **프로필 이미지 업로드**(Supabase Storage), 자기소개 |
| ✍️ **리뷰 CRUD** | 별점·감상평·관람상태(봤어요/보는중/보고싶어요) 작성·수정·삭제 |
| 🔎 **작품 검색** | TMDB 연동 영화/TV 검색 · 인기/평점/상영중/개봉예정 둘러보기 · 장르·국가 필터 |
| 🎞 **작품 상세** | 출연진·감독·예고편·비슷한 작품, 배우 필모그래피 |
| 💬 **소셜** | 댓글, 좋아요, 다른 사용자 공개 프로필 |
| 🤖 **AI 무비봇** | 줄거리 안내(info) · "기억나는 장면/배우"로 작품 찾기(identify) — **Groq LLM + TMDB 보강** |
| 📊 **마이페이지·관리자** | 내 기록 통계(평균 별점·선호 장르), 관리자 대시보드 |

## 🛠 기술 스택

- **백엔드**: Node.js, Express
- **뷰**: EJS (서버 사이드 렌더링)
- **데이터베이스 / 인증 / 파일저장**: **Supabase** (PostgreSQL · Auth · Storage)
- **외부 API**: [TMDB](https://www.themoviedb.org/) (작품 정보), [Groq](https://groq.com/) (무료 LLM, OpenAI 호환)
- **배포**: Vercel

## 🚀 시작하기

```bash
# 1) 클론
git clone https://github.com/Jindevelopment/CineLog.git
cd CineLog

# 2) 의존성 설치
npm install

# 3) 환경 변수 설정 (.env.example 복사 후 값 채우기)
cp .env.example .env

# 4) (최초 1회) Supabase 스키마 + 시드 데이터
#    - Supabase 대시보드 SQL Editor에서 supabase/schema.sql 실행
#    - 시드 데이터 이전:
npm run migrate

# 5) 실행
npm start
# → http://localhost:3000
```

### 🔑 환경 변수 (`.env`)

`.env.example`을 참고해 아래 값을 채웁니다.

| 변수 | 설명 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | Supabase anon 키 (공개용) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 (**비밀**) |
| `TMDB_API_KEY` | TMDB API 키 |
| `GROQ_API_KEY` | Groq API 키 (무료, console.groq.com) |
| `SITE_URL` | 로컬 `http://localhost:3000` / 배포 시 배포 주소 |

> ⚠️ `.env`는 절대 깃에 커밋하지 마세요. (이미 `.gitignore`에 포함)

## 🗂 폴더 구조

```
CineLog/
├─ app.js                # Express 진입점 · 인증 미들웨어 · 홈/마이페이지
├─ lib/supabase.js       # Supabase 클라이언트 + 행→뷰객체 매퍼
├─ routes/               # 라우터
│  ├─ auth.js            #   회원가입(메일인증)·로그인·OAuth
│  ├─ reviews.js         #   리뷰 CRUD · TMDB 검색
│  ├─ movies.js          #   작품 상세 · 배우 필모그래피
│  ├─ comments.js        #   댓글
│  ├─ users.js           #   프로필 · 닉네임 · 아바타 업로드
│  ├─ recommend.js       #   AI 무비봇 (Groq)
│  └─ admin.js           #   관리자 대시보드
├─ views/                # EJS 템플릿
├─ public/               # 정적 파일 (CSS·JS·이미지)
├─ supabase/schema.sql   # DB 스키마 (테이블·트리거·RLS·Storage)
└─ scripts/migrate-seed.js  # 시드 데이터 마이그레이션
```

## ☁️ 배포 (Vercel)

1. GitHub 저장소를 Vercel에 Import
2. **환경 변수** 등록 (위 표의 6개, `SITE_URL`은 배포 주소)
3. 배포 후:
   - Supabase → Authentication → **Redirect URLs**에 `https://<배포주소>/auth/callback` 추가
   - Google/Kakao OAuth redirect에도 배포 도메인 반영

## 👤 만든이

**최진혁** · 명지대학교 인터넷프로그래밍

---

<div align="center"><sub>🎬 영화의 기억을 기록하다 — CineLog</sub></div>
