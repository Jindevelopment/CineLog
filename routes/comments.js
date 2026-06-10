// routes/comments.js — 댓글 CRUD (Supabase)
import express from 'express'
import { supaAdmin } from '../lib/supabase.js'
import { requireLogin } from './auth.js'

const router = express.Router()

// ─── 1) 댓글 작성 ────────────────────────────────────────
router.post('/', requireLogin, async (req, res) => {
  const { reviewId, content } = req.body
  if (!content || !content.trim()) return res.redirect(`/reviews/${reviewId}`)

  await supaAdmin.from('comments').insert({
    review_id: Number(reviewId),
    author_id: req.currentUser.id,
    content:   content.trim()
  })

  res.redirect(`/reviews/${reviewId}`)
})

// ─── 2) 댓글 수정 ────────────────────────────────────────
router.post('/:id/edit', requireLogin, async (req, res) => {
  const id = Number(req.params.id)
  const { content, reviewId } = req.body

  const { data: comment } = await supaAdmin.from('comments').select('author_id').eq('id', id).maybeSingle()
  if (!comment) return res.status(404).send('댓글이 없습니다.')
  if (comment.author_id !== req.currentUser.id) return res.status(403).send('본인 댓글만 수정할 수 있습니다.')
  if (!content || !content.trim()) return res.redirect(`/reviews/${reviewId}`)

  await supaAdmin.from('comments').update({ content: content.trim() }).eq('id', id)
  res.redirect(`/reviews/${reviewId}`)
})

// ─── 3) 댓글 삭제 ────────────────────────────────────────
router.post('/:id/delete', requireLogin, async (req, res) => {
  const id = Number(req.params.id)
  const { reviewId } = req.body

  const { data: comment } = await supaAdmin.from('comments').select('author_id').eq('id', id).maybeSingle()
  if (!comment) return res.status(404).send('댓글이 없습니다.')

  if (comment.author_id !== req.currentUser.id && !req.currentUser.isAdmin)
    return res.status(403).send('본인 댓글만 삭제할 수 있습니다.')

  await supaAdmin.from('comments').delete().eq('id', id)
  res.redirect(`/reviews/${reviewId}`)
})

export default router
