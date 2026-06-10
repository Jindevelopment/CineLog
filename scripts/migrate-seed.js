// scripts/migrate-seed.js
// db.json(lowdb)의 시드 데이터를 Supabase(Postgres + Auth + Storage)로 이전합니다.
//
// 사전 준비:
//   1) supabase/schema.sql 을 Supabase SQL Editor에서 먼저 실행
//   2) npm i @supabase/supabase-js
//   3) .env 에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정
//
// 실행:  node scripts/migrate-seed.js
//
// ⚠️ 한 번만 실행하세요. (auth 유저는 이미 있으면 건너뜁니다)
//    시드 유저 비밀번호는 아래 SEED_PASSWORD 로 통일됩니다.

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

const SEED_PASSWORD = 'cinelog1234'         // 시드 계정 공통 임시 비밀번호
const EMAIL_DOMAIN  = 'cinelog.local'       // username -> username@cinelog.local

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('❌ .env 에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.')
  process.exit(1)
}
const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const db = JSON.parse(readFileSync('db.json', 'utf-8'))
const log = (...a) => console.log(...a)

// ── 로컬 아바타 파일을 Storage(avatars 버킷)로 업로드하고 공개 URL 반환 ──
async function uploadAvatar(avatarPath) {
  if (!avatarPath) return null
  const localFile = path.join('public', avatarPath)        // 예: public/uploads/avatars/seed-admin.svg
  if (!existsSync(localFile)) {
    log(`   ⚠️  아바타 파일 없음, 건너뜀: ${localFile}`)
    return null
  }
  const fileName = path.basename(avatarPath)
  const ext = path.extname(fileName).toLowerCase()
  const contentType = ext === '.svg' ? 'image/svg+xml'
    : ext === '.png' ? 'image/png'
    : ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp' : 'image/jpeg'

  const buffer = readFileSync(localFile)
  const { error } = await supa.storage.from('avatars').upload(fileName, buffer, { contentType, upsert: true })
  if (error) { log(`   ⚠️  아바타 업로드 실패(${fileName}): ${error.message}`); return null }
  const { data } = supa.storage.from('avatars').getPublicUrl(fileName)
  return data.publicUrl
}

async function main() {
  log('▶ CineLog 시드 마이그레이션 시작\n')

  // ── 1) 유저 → auth.users + profiles ────────────────────────
  const idMap = new Map()  // 기존 int id -> 새 uuid
  for (const u of db.users) {
    const email = `${u.username}@${EMAIL_DOMAIN}`
    log(`👤 ${u.username}  (${email})`)

    // auth 유저 생성 (username 은 metadata로 전달 → 트리거가 profiles 자동 생성)
    let uid
    const { data: created, error: cErr } = await supa.auth.admin.createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { username: u.username }
    })
    if (cErr) {
      // 이미 존재하면 목록에서 찾아 매핑
      if (/already|registered|exists/i.test(cErr.message)) {
        const { data: list } = await supa.auth.admin.listUsers({ perPage: 1000 })
        const found = list?.users?.find(x => x.email === email)
        if (!found) { log(`   ❌ 생성 실패 & 조회 실패: ${cErr.message}`); continue }
        uid = found.id
        log('   ↺ 이미 존재 → 기존 계정 사용')
      } else {
        log(`   ❌ ${cErr.message}`); continue
      }
    } else {
      uid = created.user.id
    }
    idMap.set(u.id, uid)

    // 아바타 업로드
    const avatarUrl = await uploadAvatar(u.avatar)

    // profiles 보강 (트리거가 만든 행을 실제 값으로 업데이트)
    const { error: pErr } = await supa.from('profiles').update({
      username: u.username,
      bio: u.bio || '',
      avatar: avatarUrl,
      is_admin: u.username === 'admin',
      created_at: u.createdAt || Date.now()
    }).eq('id', uid)
    if (pErr) log(`   ⚠️  profiles 업데이트 실패: ${pErr.message}`)
  }
  log(`\n✅ 유저 ${idMap.size}명 이전 완료\n`)

  // ── 2) 리뷰 ────────────────────────────────────────────────
  const reviewIdMap = new Map()  // 기존 리뷰 int id -> 새 bigint id
  for (const r of db.reviews) {
    const authorUuid = idMap.get(r.authorId)
    if (!authorUuid) { log(`   ⚠️  리뷰 ${r.id}: 작성자 매핑 없음, 건너뜀`); continue }
    const { data, error } = await supa.from('reviews').insert({
      movie_id: String(r.movieId),
      movie_title: r.movieTitle,
      movie_poster: r.moviePoster,
      movie_genre: r.movieGenre,
      movie_year: r.movieYear ? String(r.movieYear) : null,
      media_type: r.mediaType || 'movie',
      author_id: authorUuid,
      rating: r.rating,
      content: r.content,
      status: r.status,
      likes: (r.likedBy?.length ?? r.likes ?? 0),
      views: r.views || 0,
      created_at: r.createdAt || Date.now()
    }).select('id').single()
    if (error) { log(`   ⚠️  리뷰 ${r.id} 삽입 실패: ${error.message}`); continue }
    reviewIdMap.set(r.id, data.id)
  }
  log(`✅ 리뷰 ${reviewIdMap.size}건 이전 완료\n`)

  // ── 3) 좋아요 (review_likes) ───────────────────────────────
  let likeCount = 0
  for (const r of db.reviews) {
    const newRid = reviewIdMap.get(r.id)
    if (!newRid || !Array.isArray(r.likedBy)) continue
    for (const oldUid of r.likedBy) {
      const userUuid = idMap.get(oldUid)
      if (!userUuid) continue
      const { error } = await supa.from('review_likes').insert({ review_id: newRid, user_id: userUuid })
      if (!error) likeCount++
    }
  }
  log(`✅ 좋아요 ${likeCount}건 이전 완료\n`)

  // ── 4) 댓글 ────────────────────────────────────────────────
  let commentCount = 0
  for (const c of db.comments) {
    const newRid = reviewIdMap.get(c.reviewId)
    const authorUuid = idMap.get(c.authorId)
    if (!newRid || !authorUuid) { log(`   ⚠️  댓글 ${c.id}: 매핑 없음, 건너뜀`); continue }
    const { error } = await supa.from('comments').insert({
      review_id: newRid,
      author_id: authorUuid,
      content: c.content,
      created_at: c.createdAt || Date.now()
    })
    if (error) { log(`   ⚠️  댓글 ${c.id} 삽입 실패: ${error.message}`); continue }
    commentCount++
  }
  log(`✅ 댓글 ${commentCount}건 이전 완료\n`)

  log('🎉 마이그레이션 완료!')
  log('\n── 시드 계정 로그인 정보 ───────────────────')
  for (const u of db.users) {
    log(`  ${u.username.padEnd(14)} → ${u.username}@${EMAIL_DOMAIN}  /  ${SEED_PASSWORD}`)
  }
  log('────────────────────────────────────────────')
}

main().catch(e => { console.error('마이그레이션 오류:', e); process.exit(1) })
