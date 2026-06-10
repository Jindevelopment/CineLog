// app.js — CineLog 서버 진입점 (Supabase 기반)
import 'dotenv/config'
import express from 'express'
import morgan from 'morgan'
import path from 'path'
import { fileURLToPath } from 'url'

import { supaAdmin, createServerSupabase, mapReview, REVIEW_SELECT } from './lib/supabase.js'
import authRouter from './routes/auth.js'
import reviewsRouter from './routes/reviews.js'
import moviesRouter from './routes/movies.js'
import commentsRouter from './routes/comments.js'
import usersRouter from './routes/users.js'
import adminRouter from './routes/admin.js'
import recommendRouter from './routes/recommend.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// ─── 미들웨어 ────────────────────────────────────────
app.use(morgan('dev'))
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// ─── 프로필 캐시 (avatarOf용 — 매 요청 전체조회 방지, 15초 TTL) ──
let _profCache = null, _profCacheAt = 0
async function getProfilesMap() {
  if (_profCache && Date.now() - _profCacheAt < 15000) return _profCache
  const { data } = await supaAdmin.from('profiles').select('id, username, avatar, is_admin')
  _profCache = new Map((data || []).map(p => [p.id, p]))
  _profCacheAt = Date.now()
  return _profCache
}

// ─── 인증 + 공통 로컬 변수 ────────────────────────────
app.use(async (req, res, next) => {
  res.set('Cache-Control', 'no-store')   // 동적 페이지 캐시/bfcache 방지 (조회수 즉시 반영)
  try {
    req.supabase = createServerSupabase(req, res)

    const pmap = await getProfilesMap()
    res.locals.avatarOf = (userId) => pmap.get(userId)?.avatar || null

    // 인증 쿠키가 있을 때만 Supabase JWT 검증 (익명 방문자는 네트워크 호출 생략 → 속도 ↑)
    let user = null
    if (/sb-[\w-]*-auth-token/.test(req.headers.cookie || '')) {
      const { data } = await req.supabase.auth.getUser()
      user = data?.user || null
    }

    if (user) {
      const p = pmap.get(user.id)
      req.currentUser = {
        id:       user.id,
        email:    user.email,
        username: p?.username || (user.email || '').split('@')[0],
        avatar:   p?.avatar || null,
        isAdmin:  p?.is_admin || p?.username === 'admin'
      }
    } else {
      req.currentUser = null
    }
    res.locals.currentUser = req.currentUser
    next()
  } catch (err) {
    console.error('인증 미들웨어 오류:', err.message)
    req.currentUser = null
    res.locals.currentUser = null
    res.locals.avatarOf = () => null
    next()
  }
})

// ─── 홈 ───────────────────────────────────────────────
app.get('/', async (req, res) => {
  // OAuth/이메일 인증이 루트로 돌아온 경우(?code=...) 세션 교환 후 정리
  if (req.query.code) {
    try {
      const { error } = await req.supabase.auth.exchangeCodeForSession(req.query.code)
      if (error) console.error('루트 코드 교환 오류:', error.message)
    } catch (e) { console.error('루트 코드 교환 예외:', e.message) }
    return res.redirect('/')
  }
  try {
    const { data: rows } = await supaAdmin
      .from('reviews').select(REVIEW_SELECT)
      .order('created_at', { ascending: false })
    const reviews = (rows || []).map(mapReview)

    const recentReviews  = reviews.slice(0, 6)
    const popularReviews = [...reviews].sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5)

    const { count: userCount }    = await supaAdmin.from('profiles').select('*', { count: 'exact', head: true })
    const { count: commentCount } = await supaAdmin.from('comments').select('*', { count: 'exact', head: true })

    const stats = {
      totalReviews:  reviews.length,
      totalUsers:    userCount || 0,
      totalComments: commentCount || 0
    }
    res.render('index', { recentReviews, popularReviews, stats })
  } catch (err) {
    console.error(err)
    res.status(500).send('서버 오류')
  }
})

// ─── 마이페이지 ───────────────────────────────────────
app.get('/mypage', async (req, res) => {
  if (!req.currentUser) return res.redirect('/login')
  try {
    const uid = req.currentUser.id
    const { data: profileRow } = await supaAdmin.from('profiles').select('*').eq('id', uid).single()
    const { data: rows } = await supaAdmin
      .from('reviews').select(REVIEW_SELECT)
      .eq('author_id', uid).order('created_at', { ascending: false })
    const myReviews = (rows || []).map(mapReview)

    const user = {
      id: uid, username: req.currentUser.username,
      bio: profileRow?.bio || '', avatar: profileRow?.avatar || null
    }
    const watched  = myReviews.filter(r => r.status === 'watched')
    const watching = myReviews.filter(r => r.status === 'watching')
    const want     = myReviews.filter(r => r.status === 'want')
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
    res.render('mypage', { user, myReviews, watched, watching, want, avgRating, topGenre })
  } catch (err) {
    console.error(err)
    res.status(500).send('서버 오류')
  }
})

app.use('/', authRouter)
app.use('/reviews', reviewsRouter)
app.use('/movies', moviesRouter)
app.use('/comments', commentsRouter)
app.use('/users', usersRouter)
app.use('/admin', adminRouter)
app.use('/recommend', recommendRouter)

app.use((req, res) => res.status(404).render('404'))
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).send('서버 오류가 발생했습니다.')
})

// ─── 로컬 실행 시에만 listen (Vercel 서버리스에서는 export 사용) ──
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`▶ CineLog: http://localhost:${PORT} 에서 실행 중`))
}

export default app
