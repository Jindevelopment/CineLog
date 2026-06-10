// routes/admin.js — 관리자 전용 대시보드 (Supabase)
import express from 'express'
import { supaAdmin, REVIEW_SELECT, mapReview, mapUser } from '../lib/supabase.js'
import { requireAdmin } from './auth.js'

const router = express.Router()
router.use(requireAdmin)

// ─── 관리자 대시보드 ─────────────────────────────────────
router.get('/', async (req, res) => {
  const { data: uRows } = await supaAdmin.from('profiles').select('*')
  const { data: rRows } = await supaAdmin.from('reviews').select(REVIEW_SELECT)
  const { count: commentCount } = await supaAdmin.from('comments').select('*', { count: 'exact', head: true })

  const users   = (uRows || []).map(mapUser)
  const reviews = (rRows || []).map(mapReview)

  const stats = {
    totalUsers: users.length,
    totalReviews: reviews.length,
    totalComments: commentCount || 0,
    totalViews: reviews.reduce((s, r) => s + (r.views || 0), 0),
    totalLikes: reviews.reduce((s, r) => s + (r.likes || 0), 0),
    avgRating: reviews.length
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : 0
  }

  const weekAgo = Date.now() - 1000 * 60 * 60 * 24 * 7
  stats.newUsersThisWeek = users.filter(u => u.createdAt > weekAgo).length

  const movieMap = {}
  reviews.forEach(r => {
    if (!movieMap[r.movieTitle]) movieMap[r.movieTitle] = { title: r.movieTitle, count: 0, totalRating: 0 }
    movieMap[r.movieTitle].count++
    movieMap[r.movieTitle].totalRating += r.rating
  })
  const topMovies = Object.values(movieMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(m => ({ ...m, avgRating: (m.totalRating / m.count).toFixed(1) }))

  const userActivityMap = {}
  reviews.forEach(r => {
    userActivityMap[r.authorId] = userActivityMap[r.authorId] || { username: r.authorName, reviews: 0 }
    userActivityMap[r.authorId].reviews++
  })
  const topUsers = Object.values(userActivityMap)
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, 5)

  const genreMap = {}
  reviews.forEach(r => {
    if (r.movieGenre) {
      r.movieGenre.split(',').forEach(g => {
        const t = g.trim()
        if (t) genreMap[t] = (genreMap[t] || 0) + 1
      })
    }
  })
  const genreStats = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const recentUsers = [...users]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)

  res.render('admin/dashboard', { stats, topMovies, topUsers, genreStats, recentUsers })
})

// ─── 리뷰 강제 삭제 (관리자) ─────────────────────────────
router.post('/reviews/:id/delete', async (req, res) => {
  const id = Number(req.params.id)
  await supaAdmin.from('reviews').delete().eq('id', id)  // 댓글·좋아요는 FK cascade
  res.redirect('/admin')
})

// ─── 유저 강제 삭제 (관리자) ─────────────────────────────
// auth.users 삭제 → profiles/reviews/comments 까지 FK cascade 로 정리
router.post('/users/:id/delete', async (req, res) => {
  const id = req.params.id   // uuid
  const { error } = await supaAdmin.auth.admin.deleteUser(id)
  if (error) console.error('유저 삭제 오류:', error.message)
  res.redirect('/admin')
})

export default router
