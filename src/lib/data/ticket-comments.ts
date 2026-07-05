import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommentVisibility, CommentType } from '@/types/domain'

export type TicketComment = {
  id: string
  workspace_id: string
  ticket_id: string
  author_user_id: string
  body: string
  visibility: CommentVisibility
  type: CommentType
  created_at: string
  updated_at: string
}

/**
 * The comment thread on a ticket, oldest-first. RLS (0012) scopes visibility per role:
 * managers/accountant see PUBLIC + INTERNAL; a tenant sees only PUBLIC comments on
 * tickets they reported (INTERNAL comments on their own ticket are invisible — the
 * internal-comment-leak close). This layer just applies the workspace + ticket scope;
 * the internal/public boundary is enforced in the DB. Double-scoped.
 */
export async function listTicketComments(
  supabase: SupabaseClient,
  workspaceId: string,
  ticketId: string
): Promise<TicketComment[]> {
  const { data, error } = await supabase
    .from('ticket_comments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as TicketComment[]
}

export type CreateTicketCommentInput = {
  workspaceId: string
  ticketId: string
  authorUserId: string
  body: string
  visibility: CommentVisibility
  type?: CommentType
}

/**
 * Insert a comment. RLS (0012) enforces WHO may set visibility = 'INTERNAL': tenants
 * are pinned to PUBLIC by comments_insert_own_public (a tenant POSTing INTERNAL is
 * rejected); only managers may create INTERNAL via comments_insert_manager. author_id
 * is pinned to auth.uid() by the DB policies, so the caller must pass the acting
 * user's id.
 */
export async function createTicketComment(
  supabase: SupabaseClient,
  input: CreateTicketCommentInput
): Promise<TicketComment> {
  const { data, error } = await supabase
    .from('ticket_comments')
    .insert({
      workspace_id: input.workspaceId,
      ticket_id: input.ticketId,
      author_user_id: input.authorUserId,
      body: input.body,
      visibility: input.visibility,
      type: input.type ?? 'MESSAGE',
    })
    .select()
    .single()
  if (error) throw error
  return data as TicketComment
}
