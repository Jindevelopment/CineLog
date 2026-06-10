// public/main.js — 클라이언트 스크립트

// ── 1) 다크/라이트 모드 토글 ────────────────────────────
const themeToggle = document.getElementById('themeToggle')
const html = document.documentElement
const savedTheme = localStorage.getItem('theme') || 'dark'
html.setAttribute('data-theme', savedTheme)
if (themeToggle) themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙'

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme')
    const next = current === 'dark' ? 'light' : 'dark'
    html.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    themeToggle.textContent = next === 'dark' ? '☀️' : '🌙'
  })
}

// ── 2) 삭제 확인창 ──────────────────────────────────────
document.querySelectorAll('form[data-confirm]').forEach(form => {
  form.addEventListener('submit', e => {
    const msg = form.getAttribute('data-confirm') || '계속 진행할까요?'
    if (!confirm(msg)) e.preventDefault()
  })
})

// ── 2) 햄버거 메뉴 (모바일 반응형) ─────────────────────
const hamburger = document.getElementById('hamburger')
const navMenu   = document.getElementById('nav-menu')
if (hamburger && navMenu) {
  hamburger.addEventListener('click', () => {
    navMenu.classList.toggle('open')
  })
  document.addEventListener('click', e => {
    if (!hamburger.contains(e.target) && !navMenu.contains(e.target)) {
      navMenu.classList.remove('open')
    }
  })
}

// ── 3) 별점 선택 ────────────────────────────────────────
const starSelect  = document.getElementById('starSelect')
const ratingInput = document.getElementById('ratingInput')
const starHint    = starSelect?.querySelector('.star-hint')

if (starSelect && ratingInput) {
  const stars  = starSelect.querySelectorAll('.star-opt')
  const labels = ['', '별로예요', '그저 그래요', '보통이에요', '좋아요', '최고예요!']

  stars.forEach(star => {
    star.addEventListener('mouseenter', () => {
      const val = Number(star.dataset.val)
      stars.forEach((s, i) => s.classList.toggle('selected', i < val))
      if (starHint) starHint.textContent = `${val}점 — ${labels[val]}`
    })

    star.addEventListener('click', () => {
      const val = Number(star.dataset.val)
      ratingInput.value = val
      stars.forEach((s, i) => s.classList.toggle('selected', i < val))
      if (starHint) starHint.textContent = `${val}점 — ${labels[val]} ✓`
    })
  })

  starSelect.addEventListener('mouseleave', () => {
    const current = Number(ratingInput.value)
    stars.forEach((s, i) => s.classList.toggle('selected', i < current))
    if (starHint) starHint.textContent = current ? `${current}점 — ${labels[current]} ✓` : '별점을 선택하세요'
  })
}

// ── 4) 좋아요 버튼 (AJAX) ────────────────────────────────
const likeBtn = document.getElementById('likeBtn')
if (likeBtn) {
  likeBtn.addEventListener('click', async () => {
    const id = likeBtn.dataset.id
    try {
      const res  = await fetch(`/reviews/${id}/like`, { method: 'POST' })
      const data = await res.json()
      document.getElementById('likeCount').textContent = data.likes
      likeBtn.classList.toggle('liked', data.liked)
    } catch (e) {
      console.error('좋아요 오류:', e)
    }
  })
}

// ── 5) 장르 바 차트 너비 적용 ────────────────────────────
document.querySelectorAll('.genre-bar-fill').forEach(el => {
  el.style.width = (el.dataset.pct || 0) + '%'
})

// ── 7) AI 추천 예시/가이드 버튼 ──────────────────────────
function setQuery(text) {
  const input = document.getElementById('aiInput')
  if (input) {
    input.value = text
    input.focus()
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// AI 로딩 표시
const aiForm = document.getElementById('aiForm')
const aiBtn  = document.getElementById('aiSubmitBtn')
if (aiForm && aiBtn) {
  aiForm.addEventListener('submit', () => {
    aiBtn.innerHTML = '<span class="ai-loading">⏳ AI가 분석 중...</span>'
    aiBtn.disabled = true
  })
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
    btn.classList.add('active')
    const target = document.getElementById(`tab-${tab}`)
    if (target) target.classList.add('active')
  })
})

// ── 8) 댓글 인라인 수정 토글 ─────────────────────────────
function setCommentEditMode(id, editing) {
  const item = document.getElementById(`comment-${id}`)
  if (!item) return
  const view    = item.querySelector('[data-view]')
  const editForm = item.querySelector('[data-edit]')
  const actions = item.querySelector('[data-actions]')
  if (view)     view.hidden = editing
  if (editForm) editForm.hidden = !editing
  if (actions)  actions.hidden = editing
}

document.querySelectorAll('[data-edit-btn]').forEach(btn => {
  btn.addEventListener('click', () => setCommentEditMode(btn.dataset.editBtn, true))
})
document.querySelectorAll('[data-cancel-edit]').forEach(btn => {
  btn.addEventListener('click', () => setCommentEditMode(btn.dataset.cancelEdit, false))
})