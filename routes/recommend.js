// routes/recommend.js — OpenAI GPT-4o-mini 기반 영화/TV 추천
import express from 'express'
import { requireLogin } from './auth.js'

const router = express.Router()

// ─── TMDB 검색 헬퍼 (한국어/영어 + 연도로 정확 매칭) ─────────────
function toCard(m) {
  return {
    id:       m.id,
    title:    m.title || m.name,
    poster:   m.poster_path || null,
    rating:   m.vote_average ? m.vote_average.toFixed(1) : null,
    overview: m.overview,
    year:     (m.release_date || m.first_air_date || '').slice(0, 4)
  }
}

async function searchTmdb(title, originalTitle, type = 'movie', wantYear = '') {
  const key = process.env.TMDB_API_KEY
  const tmdbType = type === 'tv' ? 'tv' : 'movie'
  const queries = [...new Set([title, originalTitle].filter(Boolean))]

  // 두 제목으로 검색한 결과를 모두 모음
  let candidates = []
  for (const q of queries) {
    try {
      const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${key}&query=${encodeURIComponent(q)}&language=ko-KR`
      const res  = await fetch(url)
      const data = await res.json()
      if (data.results?.length) candidates.push(...data.results)
    } catch { /* 다음 제목 시도 */ }
  }
  if (!candidates.length) return null

  // 중복 제거(id 기준)
  const seen = new Set()
  candidates = candidates.filter(m => !seen.has(m.id) && seen.add(m.id))

  // 점수화: 연도 일치(동명이작 구분) > 포스터 보유 > 인기/평점수
  const yr = parseInt(wantYear, 10)
  const score = m => {
    let s = 0
    const my = parseInt((m.release_date || m.first_air_date || '').slice(0, 4), 10)
    if (yr && my) {
      const diff = Math.abs(my - yr)
      if (diff === 0) s += 1000
      else if (diff === 1) s += 400
      else s -= diff * 5
    }
    if (m.poster_path) s += 100
    s += Math.min(m.vote_count || 0, 500) / 10
    s += (m.popularity || 0) / 50
    return s
  }
  candidates.sort((a, b) => score(b) - score(a))
  return toCard(candidates[0])
}

// ─── AI 추천 페이지 ──────────────────────────────────
router.get('/', requireLogin, (req, res) => {
  res.render('recommend/index')
})

// ─── AI 채팅 API ─────────────────────────────────────
router.post('/chat', requireLogin, async (req, res) => {
  const { message, history = [] } = req.body
  if (!message?.trim()) return res.json({ error: '메시지를 입력해주세요.' })

  try {
    const systemPrompt = `당신은 CineLog의 영화/드라마 정보 도우미입니다.
당신이 하는 일은 딱 두 가지입니다.

(1) 정보 안내(info): 사용자가 특정 작품 이름을 대며 "줄거리/정보 알려줘" 라고 물으면,
    그 작품 1개를 items에 담고, message에 줄거리와 핵심 정보(감독/주연/분위기 등)를 설명합니다.
(2) 작품 찾기(identify): 사용자가 줄거리·장면·등장 배우·특징을 묘사하며 "이 영화 뭐야 / 찾아줘" 라고 하면,
    가장 가능성 높은 작품을 1~3개 items에 담고, message에 "왜 그 작품으로 추정했는지" 근거를 설명합니다.

위 두 경우가 아니면 intent "chat" 으로 items는 빈 배열 [] 로 두고 자연스럽게 대화합니다.

아래 JSON 형식으로만, 마크다운 없이 순수 JSON만 출력하세요.
{
  "intent": "info 또는 identify 또는 chat",
  "message": "사용자에게 보여줄 자연스러운 한국어 답변(줄거리 설명 또는 추정 근거)",
  "items": [
    {
      "title": "한국어 제목",
      "original_title": "영어 원제",
      "year": "개봉/방영 연도",
      "type": "movie 또는 tv",
      "reason": "info면 줄거리 한두 줄 요약, identify면 이 작품으로 추정한 근거",
      "genre": "장르"
    }
  ]
}

규칙:
- 절대 단순 추천 목록(나열식 추천)을 만들지 마세요. 오직 '정보 안내'와 '작품 찾기'만 합니다.
- identify: 확실하지 않으면 가장 유력한 후보 순으로 최대 3개까지. 단정 짓지 말고 "~일 가능성이 높아요" 처럼 안내.
- info: 반드시 1개만. 줄거리는 스포일러 핵심 결말은 피해서 소개.
- 배우 이름이 묘사에 나오면 그 배우의 대표 출연작 중 설명과 맞는 작품을 우선 고려.
- 한국 작품을 묘사하면 한국 작품으로 찾습니다. title/original_title은 TMDB에서 검색되도록 정확히 적으세요.
- message는 자연스러운 한국어로만 작성하고, 한자(中文)를 절대 섞지 마세요.`

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8),
      { role: 'user', content: message }
    ]

    // Groq (OpenAI 호환 API) — 무료 LLM 추론
    const openaiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
        max_tokens: 1500,
        response_format: { type: 'json_object' }  // JSON 모드 강제
      })
    })

    const openaiData = await openaiRes.json()

    if (openaiData.error) {
      console.error('Groq 오류:', openaiData.error)
      throw new Error(openaiData.error.message)
    }

    const rawText = openaiData?.choices?.[0]?.message?.content || ''
    const aiResult = JSON.parse(rawText)

    // TMDB에서 포스터/정보 보강
    const enrichedItems = await Promise.all(
      (aiResult.items || []).map(async item => {
        const tmdb = await searchTmdb(item.title, item.original_title, item.type, item.year)
        return { ...item, tmdb }
      })
    )

    res.json({
      intent:  aiResult.intent || 'chat',
      message: aiResult.message || '',
      items:   enrichedItems
    })

  } catch (err) {
    console.error('AI 추천 오류:', err.message)
    res.json({ error: `오류가 발생했습니다: ${err.message}` })
  }
})

export default router