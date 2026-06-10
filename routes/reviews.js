// routes/reviews.js — 영화 리뷰 CRUD + 검색/정렬/페이지네이션 (Supabase)
import express from 'express'
import { supaAdmin, REVIEW_SELECT, COMMENT_SELECT, mapReview, mapComment } from '../lib/supabase.js'
import { requireLogin } from './auth.js'

const router = express.Router()
const PAGE_SIZE = 9

// ─── TMDB 장르 ID → 이름 맵 ─────────────────────────────
const GENRE_MAP = {
  28: '액션', 12: '모험', 16: '애니메이션', 35: '코미디',
  80: '범죄', 99: '다큐멘터리', 18: '드라마', 10751: '가족',
  14: '판타지', 36: '역사', 27: '공포', 10402: '음악',
  9648: '미스터리', 10749: '로맨스', 878: 'SF',
  10770: 'TV 영화', 53: '스릴러', 10752: '전쟁', 37: '서부',
  10759: '액션/모험', 10762: '어린이', 10763: '뉴스',
  10764: '리얼리티', 10765: 'SF/판타지', 10766: '드라마(일일)',
  10767: '토크쇼', 10768: '전쟁/정치', 10769: '외국'
}

function genreIdsToNames(ids) {
  if (!ids) return ''
  return ids.toString().split(',')
    .map(id => GENRE_MAP[Number(id.trim())] || '')
    .filter(Boolean)
    .join(', ')
}

// ─── TMDB 상세 정보 (출연진·감독·런타임·예고편) ─────────────
async function fetchTmdbDetails(id, mediaType) {
  if (!id || !process.env.TMDB_API_KEY) return null
  const key = process.env.TMDB_API_KEY
  const types = mediaType ? [mediaType] : ['movie', 'tv']

  for (const t of types) {
    try {
      const url = `https://api.themoviedb.org/3/${t}/${id}?api_key=${key}&language=ko-KR&append_to_response=credits,videos`
      const resp = await fetch(url)
      if (!resp.ok) continue
      const d = await resp.json()
      if (!d.id) continue

      const director = t === 'movie'
        ? d.credits?.crew?.find(c => c.job === 'Director')
        : d.created_by?.[0]
      const runtime = t === 'movie' ? d.runtime : d.episode_run_time?.[0]
      const trailer = d.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')
                   || d.videos?.results?.find(v => v.site === 'YouTube')

      return {
        type:        t,
        runtime:     runtime || null,
        tagline:     d.tagline || '',
        country:     (d.production_countries || []).map(c => c.name).join(', '),
        voteAverage: d.vote_average ? d.vote_average.toFixed(1) : null,
        voteCount:   d.vote_count || 0,
        director:    director ? { id: director.id, name: director.name, profile: director.profile_path } : null,
        cast: (d.credits?.cast || []).slice(0, 8).map(c => ({
          id: c.id, name: c.name, character: c.character, profile: c.profile_path
        })),
        trailer: trailer ? trailer.key : null
      }
    } catch { continue }
  }
  return null
}

// ─── 1) 리뷰 목록 (검색 + 정렬 + 장르 필터 + 페이지네이션) ───
router.get('/', async (req, res) => {
  const { q = '', sort = 'newest', genre = '', page = 1 } = req.query

  const { data: rows } = await supaAdmin.from('reviews').select(REVIEW_SELECT)
  let reviews = (rows || []).map(mapReview)
  const allReviews = reviews

  if (q) {
    const kw = q.toLowerCase()
    reviews = reviews.filter(r =>
      (r.movieTitle || '').toLowerCase().includes(kw) ||
      (r.content || '').toLowerCase().includes(kw)
    )
  }
  if (genre) reviews = reviews.filter(r => r.movieGenre && r.movieGenre.includes(genre))

  if (sort === 'newest')  reviews.sort((a, b) => b.createdAt - a.createdAt)
  if (sort === 'rating')  reviews.sort((a, b) => b.rating - a.rating)
  if (sort === 'popular') reviews.sort((a, b) => (b.likes || 0) - (a.likes || 0))
  if (sort === 'views')   reviews.sort((a, b) => (b.views || 0) - (a.views || 0))

  const totalCount = reviews.length
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const currentPage = Math.max(1, Math.min(Number(page), totalPages || 1))
  const paginatedReviews = reviews.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const allGenres = [...new Set(
    allReviews.flatMap(r => {
      if (!r.movieGenre) return []
      return r.movieGenre.split(',').map(g => {
        const trimmed = g.trim()
        return GENRE_MAP[Number(trimmed)] || trimmed
      })
    })
  )].filter(Boolean).sort()

  res.render('reviews/list', {
    reviews: paginatedReviews,
    q, sort, genre,
    currentPage, totalPages, totalCount,
    allGenres
  })
})

function isReadableTitle(s) {
  return /[A-Za-z가-힣]/.test(s || '')
}

// ─── 2) 영화 + TV 검색 + 브라우즈 (TMDB API 연동) ──────────
router.get('/search', requireLogin, async (req, res) => {
  let { q = '', browse = '', type = 'movie', tsort = 'default', genre = '', country = '' } = req.query
  let movies = []

  const GENRE_NAME_TO_ID = Object.fromEntries(
    Object.entries(GENRE_MAP).map(([id, name]) => [name, Number(id)])
  )
  const genreId = GENRE_NAME_TO_ID[genre] || ''

  if (!q && !browse && !genreId) browse = 'popular'

  const catSort = browse === 'top_rated'
    ? 'sort_by=vote_average.desc&vote_count.gte=100'
    : 'sort_by=popularity.desc'

  try {
    const key = process.env.TMDB_API_KEY
    const dType = type === 'tv' ? 'tv' : 'movie'
    let endpoint = ''
    let excludeKorean = false

    if (q) {
      endpoint = `https://api.themoviedb.org/3/search/${type}?api_key=${key}&query=${encodeURIComponent(q)}&language=ko-KR`
    } else if (country === 'ko' || country === 'foreign') {
      const genrePart = genreId ? `&with_genres=${genreId}` : ''
      const langPart  = country === 'ko' ? '&with_original_language=ko' : ''
      endpoint = `https://api.themoviedb.org/3/discover/${dType}?api_key=${key}&language=ko-KR&${catSort}${genrePart}${langPart}`
      if (country === 'foreign') excludeKorean = true
    } else if (browse) {
      endpoint = `https://api.themoviedb.org/3/${dType}/${browse}?api_key=${key}&language=ko-KR&page=1`
    } else if (genreId) {
      endpoint = `https://api.themoviedb.org/3/discover/${dType}?api_key=${key}&with_genres=${genreId}&language=ko-KR&sort_by=popularity.desc`
    }

    if (endpoint) {
      const data = await (await fetch(endpoint)).json()
      movies = (data.results || []).map(m => ({
        ...m,
        title: m.title || m.name,
        release_date: m.release_date || m.first_air_date,
        genre_names: genreIdsToNames(m.genre_ids)
      }))

      if (movies.some(m => !isReadableTitle(m.title))) {
        try {
          const enData = await (await fetch(endpoint.replace('language=ko-KR', 'language=en-US'))).json()
          const enMap = new Map((enData.results || []).map(m => [m.id, m.title || m.name]))
          movies.forEach(m => {
            if (isReadableTitle(m.title)) return
            const en = enMap.get(m.id)
            if (en && isReadableTitle(en)) m.title = en
            else if (isReadableTitle(m.original_title || m.original_name)) m.title = m.original_title || m.original_name
          })
        } catch { /* 영문 보강 실패 시 원래 제목 유지 */ }
      }

      if (q && country === 'ko')      movies = movies.filter(m => m.original_language === 'ko')
      if (q && country === 'foreign') movies = movies.filter(m => m.original_language !== 'ko')
      if (excludeKorean) movies = movies.filter(m => m.original_language !== 'ko')

      if (genreId && (q || (browse && !country))) {
        movies = movies.filter(m => (m.genre_ids || []).includes(genreId))
      }
    }

    if (tsort === 'rating_desc') movies.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
    if (tsort === 'rating_asc')  movies.sort((a, b) => (a.vote_average || 0) - (b.vote_average || 0))
    if (tsort === 'date_desc')   movies.sort((a, b) => new Date(b.release_date || 0) - new Date(a.release_date || 0))
    if (tsort === 'date_asc')    movies.sort((a, b) => new Date(a.release_date || 0) - new Date(b.release_date || 0))

  } catch (e) {
    console.error('TMDB 오류:', e)
  }

  const searchGenres = type === 'tv'
    ? ['액션/모험', 'SF/판타지', '드라마', '코미디', '범죄', '다큐멘터리', '어린이', '리얼리티']
    : ['액션', '드라마', '코미디', 'SF', '공포', '로맨스', '스릴러', '애니메이션', '범죄', '판타지']

  res.render('reviews/search', { movies, q, browse, type, tsort, genre, country, searchGenres })
})

// ─── 3) 리뷰 작성 폼 ────────────────────────────────────
router.get('/new', requireLogin, (req, res) => {
  const { movieId, movieTitle, moviePoster, movieGenre, movieYear, mediaType } = req.query
  res.render('reviews/new', { movieId, movieTitle, moviePoster, movieGenre, movieYear, mediaType, error: null })
})

// ─── 4) 리뷰 저장 ────────────────────────────────────────
router.post('/', requireLogin, async (req, res) => {
  const { movieId, movieTitle, moviePoster, movieGenre, movieYear, rating, content, status, mediaType } = req.body

  if (!movieTitle || !content || !rating)
    return res.render('reviews/new', {
      movieId, movieTitle, moviePoster, movieGenre, movieYear, mediaType,
      error: '필수 항목을 모두 입력하세요.'
    })

  const genreNames = genreIdsToNames(movieGenre) || movieGenre || ''

  await supaAdmin.from('reviews').insert({
    movie_id:     movieId ? String(movieId) : '',
    movie_title:  movieTitle,
    movie_poster: moviePoster || '',
    movie_genre:  genreNames,
    movie_year:   movieYear || '',
    media_type:   mediaType === 'tv' ? 'tv' : 'movie',
    author_id:    req.currentUser.id,
    rating:       Number(rating),
    content,
    status:       status || 'watched'
  })

  res.redirect('/reviews')
})

// ─── 5) 리뷰 상세 + 조회수 증가 ─────────────────────────
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const { data: row } = await supaAdmin.from('reviews').select(REVIEW_SELECT).eq('id', id).maybeSingle()
  if (!row) return res.status(404).render('404')

  await supaAdmin.from('reviews').update({ views: (row.views || 0) + 1 }).eq('id', id)

  const review = mapReview(row)
  review.views = (row.views || 0) + 1

  const { data: cRows } = await supaAdmin
    .from('comments').select(COMMENT_SELECT).eq('review_id', id).order('created_at', { ascending: true })
  const comments = (cRows || []).map(mapComment)

  const author = {
    id: review.authorId, username: review.authorName,
    avatar: res.locals.avatarOf(review.authorId)
  }

  const tmdb = await fetchTmdbDetails(review.movieId, review.mediaType)

  res.render('reviews/detail', { review, comments, author, tmdb })
})

// ─── 6) 리뷰 수정 폼 ─────────────────────────────────────
router.get('/:id/edit', requireLogin, async (req, res) => {
  const id = Number(req.params.id)
  const { data: row } = await supaAdmin.from('reviews').select(REVIEW_SELECT).eq('id', id).maybeSingle()
  if (!row) return res.status(404).render('404')
  if (row.author_id !== req.currentUser.id) return res.status(403).send('본인 리뷰만 수정할 수 있습니다.')

  res.render('reviews/edit', { review: mapReview(row), error: null })
})

// ─── 7) 리뷰 수정 저장 ───────────────────────────────────
router.post('/:id/edit', requireLogin, async (req, res) => {
  const id = Number(req.params.id)
  const { data: row } = await supaAdmin.from('reviews').select('author_id').eq('id', id).maybeSingle()
  if (!row) return res.status(404).render('404')
  if (row.author_id !== req.currentUser.id) return res.status(403).send('본인 리뷰만 수정할 수 있습니다.')

  const { rating, content, status } = req.body
  await supaAdmin.from('reviews')
    .update({ rating: Number(rating), content, status }).eq('id', id)

  res.redirect(`/reviews/${id}`)
})

// ─── 8) 리뷰 삭제 (FK on delete cascade → 댓글·좋아요 자동 삭제) ──
router.post('/:id/delete', requireLogin, async (req, res) => {
  const id = Number(req.params.id)
  const { data: row } = await supaAdmin.from('reviews').select('author_id').eq('id', id).maybeSingle()
  if (!row) return res.status(404).render('404')

  if (row.author_id !== req.currentUser.id && !req.currentUser.isAdmin)
    return res.status(403).send('본인 리뷰만 삭제할 수 있습니다.')

  await supaAdmin.from('reviews').delete().eq('id', id)
  res.redirect('/reviews')
})

// ─── 9) 좋아요 토글 ──────────────────────────────────────
router.post('/:id/like', requireLogin, async (req, res) => {
  const id = Number(req.params.id)
  const uid = req.currentUser.id

  const { data: row } = await supaAdmin.from('reviews').select('likes').eq('id', id).maybeSingle()
  if (!row) return res.status(404).json({ error: '없음' })

  const { data: existing } = await supaAdmin
    .from('review_likes').select('review_id').eq('review_id', id).eq('user_id', uid).maybeSingle()

  let likes = row.likes || 0
  let liked
  if (existing) {
    await supaAdmin.from('review_likes').delete().eq('review_id', id).eq('user_id', uid)
    likes = Math.max(0, likes - 1)
    liked = false
  } else {
    await supaAdmin.from('review_likes').insert({ review_id: id, user_id: uid })
    likes = likes + 1
    liked = true
  }
  await supaAdmin.from('reviews').update({ likes }).eq('id', id)

  res.json({ likes, liked })
})

export default router
