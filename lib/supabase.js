// lib/supabase.js — Supabase 클라이언트 + 행→뷰객체 매퍼
import { createClient } from '@supabase/supabase-js'
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'

const URL     = process.env.SUPABASE_URL
const ANON    = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !ANON) console.warn('⚠️  SUPABASE_URL / SUPABASE_ANON_KEY 가 .env 에 없습니다.')

// ── 데이터 접근용 (service_role, RLS 우회) — 서버 전용 ──
export const supaAdmin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// ── 요청별 인증 클라이언트 (쿠키 세션) ──
export function createServerSupabase(req, res) {
  return createServerClient(URL, ANON, {
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie ?? '')
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.appendHeader('Set-Cookie', serializeCookieHeader(name, value, options))
        })
      }
    }
  })
}

// ── select 구문 (작성자 프로필 조인) ──
export const REVIEW_SELECT  = '*, author:profiles!author_id(username, avatar)'
export const COMMENT_SELECT = '*, author:profiles!author_id(username, avatar)'

// ── 행 → 레거시 뷰 객체 매퍼 (기존 EJS가 쓰던 camelCase 모양 유지) ──
export function mapReview(r) {
  if (!r) return null
  return {
    id:          r.id,
    movieId:     r.movie_id,
    movieTitle:  r.movie_title,
    moviePoster: r.movie_poster,
    movieGenre:  r.movie_genre,
    movieYear:   r.movie_year,
    mediaType:   r.media_type,
    authorId:    r.author_id,
    authorName:  r.author?.username || '탈퇴한 사용자',
    rating:      r.rating,
    content:     r.content,
    status:      r.status,
    likes:       r.likes || 0,
    views:       r.views || 0,
    createdAt:   Number(r.created_at)
  }
}

export function mapComment(c) {
  if (!c) return null
  return {
    id:         c.id,
    reviewId:   c.review_id,
    authorId:   c.author_id,
    authorName: c.author?.username || '탈퇴한 사용자',
    content:    c.content,
    createdAt:  Number(c.created_at)
  }
}

export function mapUser(u) {
  if (!u) return null
  return {
    id:        u.id,
    username:  u.username,
    bio:       u.bio || '',
    avatar:    u.avatar || null,
    isAdmin:   u.is_admin || u.username === 'admin',
    createdAt: Number(u.created_at)
  }
}
