// routes/movies.js — TMDB 기반 작품 정보 · 비슷한 작품 · 배우 필모그래피
import express from 'express'
import { supaAdmin, REVIEW_SELECT, mapReview } from '../lib/supabase.js'

const router = express.Router()
const BASE = 'https://api.themoviedb.org/3'

// 공통 TMDB 호출 헬퍼 (실패 시 null)
async function tmdb(path, extra = '', lang = 'ko-KR') {
  const key = process.env.TMDB_API_KEY
  if (!key) return null
  try {
    const r = await fetch(`${BASE}/${path}?api_key=${key}&language=${lang}${extra}`)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

// 한글/영문이 아닌 제목인지 (텔루구·아랍·일본어 등)
function isReadableTitle(s) {
  return /[A-Za-z가-힣]/.test(s || '')
}

// ─── 배우 필모그래피 페이지  (반드시 /:type/:id 보다 먼저 정의) ───
router.get('/person/:id', async (req, res) => {
  const data = await tmdb(`person/${req.params.id}`, '&append_to_response=combined_credits')
  if (!data || !data.id) return res.status(404).render('404')

  // 출연작: (작품+배역) 중복 제거 → 인기순 정렬
  const seen = new Set()
  const credits = (data.combined_credits?.cast || [])
    .filter(c => {
      const k = c.media_type + '-' + c.id
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .map(c => ({
      id:        c.id,
      type:      c.media_type === 'tv' ? 'tv' : 'movie',
      title:     c.title || c.name,
      character: c.character,
      poster:    c.poster_path,
      year:      (c.release_date || c.first_air_date || '').slice(0, 4),
      rating:    c.vote_average ? c.vote_average.toFixed(1) : null
    }))

  const person = {
    id:         data.id,
    name:       data.name,
    profile:    data.profile_path,
    bio:        data.biography,
    birthday:   data.birthday,
    place:      data.place_of_birth,
    department: data.known_for_department,
    filmography: credits.filter(c => c.poster).slice(0, 24)
  }

  // 필모그래피 제목도 영문으로 보강 (외국어 작품)
  if (person.filmography.some(c => !isReadableTitle(c.title))) {
    const enCred = await tmdb(`person/${req.params.id}/combined_credits`, '', 'en-US')
    const enMap = new Map((enCred?.cast || []).map(c => [c.media_type + '-' + c.id, c.title || c.name]))
    person.filmography.forEach(c => {
      const en = enMap.get(c.type + '-' + c.id)
      if (!isReadableTitle(c.title) && isReadableTitle(en)) c.title = en
    })
  }

  res.render('movies/person', { person })
})

// ─── 작품(영화/TV) 정보 페이지 ───
router.get('/:type/:id', async (req, res) => {
  const type = req.params.type === 'tv' ? 'tv' : 'movie'
  const id   = req.params.id
  const d = await tmdb(`${type}/${id}`, '&append_to_response=credits,videos,similar')
  if (!d || !d.id) return res.status(404).render('404')

  // 한국어 제목이 없어 원어(텔루구 등)로 나온 경우 영문 제목으로 대체
  let displayTitle = d.title || d.name
  if (!isReadableTitle(displayTitle)) {
    const en = await tmdb(`${type}/${id}`, '', 'en-US')
    const enTitle = en?.title || en?.name
    if (enTitle && isReadableTitle(enTitle)) displayTitle = enTitle
    else if (isReadableTitle(d.original_title || d.original_name)) displayTitle = d.original_title || d.original_name
  }

  const director = type === 'movie'
    ? d.credits?.crew?.find(c => c.job === 'Director')
    : d.created_by?.[0]
  const trailer = d.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')
               || d.videos?.results?.find(v => v.site === 'YouTube')

  const movie = {
    id, type,
    title:         displayTitle,
    originalTitle: d.original_title || d.original_name,
    year:          (d.release_date || d.first_air_date || '').slice(0, 4),
    poster:        d.poster_path,
    backdrop:      d.backdrop_path,
    tagline:       d.tagline || '',
    overview:      d.overview || '',
    runtime:       type === 'movie' ? d.runtime : d.episode_run_time?.[0],
    genres:        (d.genres || []).map(g => g.name),
    country:       (d.production_countries || []).map(c => c.name).join(', '),
    rating:        d.vote_average ? d.vote_average.toFixed(1) : null,
    voteCount:     d.vote_count || 0,
    status:        d.status,
    releaseDate:   d.release_date || d.first_air_date,
    seasons:       d.number_of_seasons,
    episodes:      d.number_of_episodes,
    director:      director ? { id: director.id, name: director.name, profile: director.profile_path } : null,
    trailer:       trailer ? trailer.key : null,
    cast: (d.credits?.cast || []).slice(0, 10).map(c => ({
      id: c.id, name: c.name, character: c.character, profile: c.profile_path
    })),
    similar: (d.similar?.results || []).filter(s => s.poster_path).slice(0, 12).map(s => ({
      id:     s.id,
      type,
      title:  s.title || s.name,
      poster: s.poster_path,
      year:   (s.release_date || s.first_air_date || '').slice(0, 4),
      rating: s.vote_average ? s.vote_average.toFixed(1) : null
    }))
  }

  // 비슷한 작품 제목도 영문으로 보강
  if (movie.similar.some(s => !isReadableTitle(s.title))) {
    const enSim = await tmdb(`${type}/${id}/similar`, '', 'en-US')
    const enMap = new Map((enSim?.results || []).map(s => [s.id, s.title || s.name]))
    movie.similar.forEach(s => {
      const en = enMap.get(s.id)
      if (!isReadableTitle(s.title) && isReadableTitle(en)) s.title = en
    })
  }

  // 이 작품에 대한 CineLog 내부 리뷰
  const { data: rRows } = await supaAdmin
    .from('reviews').select(REVIEW_SELECT)
    .eq('movie_id', String(id)).order('created_at', { ascending: false })
  const localReviews = (rRows || []).map(mapReview)

  res.render('movies/detail', { movie, localReviews })
})

export default router
