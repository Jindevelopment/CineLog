// routes/auth.js — Supabase Auth 기반 회원가입·로그인·로그아웃 + 소셜 로그인
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { supaAdmin } from '../lib/supabase.js'

const router = express.Router()
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000'

// ─── 인증 미들웨어 (다른 라우터에서 import) ───────────────
export function requireLogin(req, res, next) {
  if (!req.currentUser) return res.redirect('/login')
  next()
}
export function requireAdmin(req, res, next) {
  if (!req.currentUser) return res.redirect('/login')
  if (!req.currentUser.isAdmin) return res.status(403).send('관리자만 접근 가능합니다.')
  next()
}

// ─── 회원가입 ────────────────────────────────────────────
router.get('/signup', (req, res) => {
  res.render('auth/signup', { error: null })
})

router.post('/signup', async (req, res) => {
  const { email, username, password, bio } = req.body

  if (!email || !username || !password)
    return res.render('auth/signup', { error: '이메일·닉네임·비밀번호를 모두 입력하세요.' })

  // 닉네임 중복 확인
  const { data: dup } = await supaAdmin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (dup) return res.render('auth/signup', { error: '이미 사용 중인 닉네임입니다.' })

  // 이메일 인증 메일 발송 (확인 링크 클릭 전에는 계정 활성화 안 됨)
  const { data, error: sErr } = await req.supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      emailRedirectTo: `${SITE_URL}/auth/callback`
    }
  })
  if (sErr) {
    const msg = /already|registered|exists/i.test(sErr.message)
      ? '이미 가입된 이메일입니다.' : sErr.message
    return res.render('auth/signup', { error: msg })
  }

  // 자기소개 저장 (트리거가 만든 프로필에 보강)
  if (bio && data?.user) await supaAdmin.from('profiles').update({ bio }).eq('id', data.user.id)

  // 자동 로그인 X — 메일 인증 안내 후 로그인 페이지로
  res.render('auth/login', {
    error: null,
    notice: `${email} 로 인증 메일을 보냈습니다. 메일의 링크를 클릭해 인증을 완료한 뒤 로그인해 주세요.`
  })
})

// ─── 로그인 ─────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.render('auth/login', { error: null })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  const { error } = await req.supabase.auth.signInWithPassword({ email, password })
  if (error)
    return res.render('auth/login', { error: '이메일/비밀번호가 일치하지 않습니다.' })
  res.redirect('/')
})

// ─── 로그아웃 ────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  await req.supabase.auth.signOut()
  res.redirect('/')
})

// ─── 소셜 로그인 (Google / Kakao) ────────────────────────
async function oauth(provider, req, res) {
  const { data, error } = await req.supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${SITE_URL}/auth/callback` }
  })
  if (error || !data?.url) return res.redirect('/login')
  res.redirect(data.url)
}
router.get('/auth/google', (req, res) => oauth('google', req, res))
router.get('/auth/kakao',  (req, res) => oauth('kakao',  req, res))

// OAuth 콜백 — 인가 코드를 세션으로 교환
router.get('/auth/callback', async (req, res) => {
  const { code, error_description } = req.query
  if (error_description) {
    console.error('OAuth 콜백 오류:', error_description)
    return res.render('auth/login', { error: '소셜 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.' })
  }
  if (code) {
    const { error } = await req.supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('OAuth 코드 교환 오류:', error.message)
      return res.render('auth/login', { error: '소셜 로그인 처리 중 오류가 발생했습니다.' })
    }
  }
  res.redirect('/')
})

export default router
