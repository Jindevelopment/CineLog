// routes/users.js — 유저 프로필 + 수정 + 비밀번호 변경 + 아바타 업로드(Storage)
import express from 'express'
import multer from 'multer'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { supaAdmin, REVIEW_SELECT, mapReview, mapUser } from '../lib/supabase.js'
import { requireLogin } from './auth.js'

const router = express.Router()

// ─── multer: 메모리 저장 후 Supabase Storage 로 업로드 ───────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|gif|webp)$/.test(file.mimetype)) cb(null, true)
    else cb(new Error('이미지 파일(JPG·PNG·GIF·WEBP)만 업로드할 수 있습니다.'))
  }
})

// ─── 1) 유저 공개 프로필 ─────────────────────────────────
router.get('/:id', async (req, res) => {
  const id = req.params.id   // uuid
  const { data: profileRow } = await supaAdmin.from('profiles').select('*').eq('id', id).maybeSingle()
  if (!profileRow) return res.status(404).render('404')
  const profileUser = mapUser(profileRow)

  const { data: rRows } = await supaAdmin
    .from('reviews').select(REVIEW_SELECT).eq('author_id', id).order('created_at', { ascending: false })
  const reviews = (rRows || []).map(mapReview)

  const watched  = reviews.filter(r => r.status === 'watched')
  const avgRating = watched.length
    ? (watched.reduce((s, r) => s + r.rating, 0) / watched.length).toFixed(1) : 0

  const genreMap = {}
  watched.forEach(r => {
    if (r.movieGenre) r.movieGenre.split(',').forEach(g => {
      const t = g.trim()
      genreMap[t] = (genreMap[t] || 0) + 1
    })
  })
  const topGenre = Object.entries(genreMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'

  res.render('users/profile', { profileUser, reviews, watched, avgRating, topGenre })
})

// ─── 2) 프로필 수정 폼 ───────────────────────────────────
router.get('/:id/edit', requireLogin, async (req, res) => {
  const id = req.params.id
  if (req.currentUser.id !== id) return res.status(403).send('본인만 수정할 수 있습니다.')

  const { data: profileRow } = await supaAdmin.from('profiles').select('*').eq('id', id).maybeSingle()
  if (!profileRow) return res.status(404).render('404')

  res.render('users/edit', { user: mapUser(profileRow), error: null, success: null })
})

// ─── 3) 프로필 수정 저장 (닉네임 + 자기소개) ──────────────
router.post('/:id/edit', requireLogin, async (req, res) => {
  const id = req.params.id
  if (req.currentUser.id !== id) return res.status(403).send('본인만 수정할 수 있습니다.')

  const username = (req.body.username || '').trim()
  const bio = req.body.bio || ''

  const reRender = (msg, ok) => supaAdmin.from('profiles').select('*').eq('id', id).maybeSingle()
    .then(({ data }) => res.render('users/edit', { user: mapUser(data), error: ok ? null : msg, success: ok ? msg : null }))

  // 닉네임 검증
  if (username.length < 2 || username.length > 20)
    return reRender('닉네임은 2~20자로 입력하세요.', false)

  // 닉네임 중복 확인 (본인 제외)
  const { data: dup } = await supaAdmin.from('profiles')
    .select('id').eq('username', username).neq('id', id).maybeSingle()
  if (dup) return reRender('이미 사용 중인 닉네임입니다.', false)

  await supaAdmin.from('profiles').update({ username, bio }).eq('id', id)
  // 현재 요청의 헤더 표시도 즉시 반영
  if (req.currentUser) req.currentUser.username = username

  return reRender('프로필이 수정되었습니다.', true)
})

// ─── 4) 비밀번호 변경 ────────────────────────────────────
router.post('/:id/password', requireLogin, async (req, res) => {
  const id = req.params.id
  if (req.currentUser.id !== id) return res.status(403).send('본인만 변경할 수 있습니다.')

  const { data: profileRow } = await supaAdmin.from('profiles').select('*').eq('id', id).maybeSingle()
  const user = mapUser(profileRow)
  const { currentPassword, newPassword } = req.body

  // 현재 비밀번호 검증 (임시 클라이언트로 로그인 시도)
  const verifier = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } })
  const { error: vErr } = await verifier.auth.signInWithPassword({
    email: req.currentUser.email, password: currentPassword
  })
  if (vErr)
    return res.render('users/edit', { user, error: '현재 비밀번호가 일치하지 않습니다.', success: null })

  if (!newPassword || newPassword.length < 4)
    return res.render('users/edit', { user, error: '새 비밀번호는 4자 이상이어야 합니다.', success: null })

  await supaAdmin.auth.admin.updateUserById(id, { password: newPassword })
  res.render('users/edit', { user, error: null, success: '비밀번호가 변경되었습니다.' })
})

// ─── 5) 프로필 이미지 업로드 (Supabase Storage) ──────────
router.post('/:id/avatar', requireLogin, (req, res) => {
  const id = req.params.id
  if (req.currentUser.id !== id) return res.status(403).send('본인만 변경할 수 있습니다.')

  upload.single('avatar')(req, res, async (err) => {
    const { data: profileRow } = await supaAdmin.from('profiles').select('*').eq('id', id).maybeSingle()
    const user = mapUser(profileRow)
    if (err)       return res.render('users/edit', { user, error: err.message, success: null })
    if (!req.file) return res.render('users/edit', { user, error: '이미지를 선택해주세요.', success: null })

    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg'
    const fileName = `user-${id}-${Date.now()}${ext}`

    const { error: upErr } = await supaAdmin.storage.from('avatars')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true })
    if (upErr)
      return res.render('users/edit', { user, error: `업로드 실패: ${upErr.message}`, success: null })

    const { data: pub } = supaAdmin.storage.from('avatars').getPublicUrl(fileName)
    await supaAdmin.from('profiles').update({ avatar: pub.publicUrl }).eq('id', id)

    user.avatar = pub.publicUrl
    res.render('users/edit', { user, error: null, success: '프로필 이미지가 변경되었습니다.' })
  })
})

export default router
