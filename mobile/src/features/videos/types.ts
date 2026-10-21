/** Tipos de la API de Reels (`API_CONTRACT.md` §4.40). Sin ids de Mux: el servidor no los entrega. */

export type ReelStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'blocked';

export type ReelVideo = {
  id: string;
  author: {
    id: string;
    username: string;
    name: string;
    avatar_url: string | null;
    is_following?: boolean;
    follow_pending?: boolean;
  };
  caption: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  likes_count?: number;
  comments_count?: number;
  liked_by_me?: boolean;
  saved_by_me?: boolean;
  /** HLS firmado y de vida corta, solo si está listo Y aprobado. */
  playback: { hls_url: string; expires_in: number } | null;
  // Solo para su dueño:
  status?: ReelStatus;
  moderation_status?: 'pending' | 'approved' | 'held' | 'rejected';
  failure_reason?: string;
};

export type ReelFeed = { videos: ReelVideo[]; has_more: boolean };

export type UploadReservation = { id: string; status: ReelStatus; upload_url: string | null };

export type ReelComment = {
  id: string;
  video_id: string;
  content: string;
  created_at: string;
  author: { id: string; username: string; name: string; avatar_url: string | null };
  can_delete: boolean;
};
