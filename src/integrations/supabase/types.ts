export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chunks: {
        Row: {
          chapter_title: string | null
          chunk_index: number
          chunk_type: string
          content: string
          created_at: string
          embedding: string | null
          id: string
          indexed_at: string | null
          page_number: number | null
          section_title: string | null
          source_id: string
          token_count: number | null
          user_id: string
        }
        Insert: {
          chapter_title?: string | null
          chunk_index: number
          chunk_type?: string
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          indexed_at?: string | null
          page_number?: number | null
          section_title?: string | null
          source_id: string
          token_count?: number | null
          user_id: string
        }
        Update: {
          chapter_title?: string | null
          chunk_index?: number
          chunk_type?: string
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          indexed_at?: string | null
          page_number?: number | null
          section_title?: string | null
          source_id?: string
          token_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      digest_runs: {
        Row: {
          citations_found: number
          created_at: string
          email_sent: boolean
          email_sent_at: string | null
          id: string
          meetings_found: number
          run_date: string
          themes_found: number
          user_id: string
        }
        Insert: {
          citations_found?: number
          created_at?: string
          email_sent?: boolean
          email_sent_at?: string | null
          id?: string
          meetings_found?: number
          run_date: string
          themes_found?: number
          user_id: string
        }
        Update: {
          citations_found?: number
          created_at?: string
          email_sent?: boolean
          email_sent_at?: string | null
          id?: string
          meetings_found?: number
          run_date?: string
          themes_found?: number
          user_id?: string
        }
        Relationships: []
      }
      digest_themes: {
        Row: {
          created_at: string
          digest_run_id: string
          id: string
          synthesis: string | null
          theme_text: string
          theme_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          digest_run_id: string
          id?: string
          synthesis?: string | null
          theme_text: string
          theme_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          digest_run_id?: string
          id?: string
          synthesis?: string | null
          theme_text?: string
          theme_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "digest_themes_digest_run_id_fkey"
            columns: ["digest_run_id"]
            isOneToOne: false
            referencedRelation: "digest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      highlights: {
        Row: {
          chapter: string | null
          chunk_id: string | null
          content: string
          created_at: string
          id: string
          note: string | null
          page: number | null
          source_id: string
          user_id: string
        }
        Insert: {
          chapter?: string | null
          chunk_id?: string | null
          content: string
          created_at?: string
          id?: string
          note?: string | null
          page?: number | null
          source_id: string
          user_id: string
        }
        Update: {
          chapter?: string | null
          chunk_id?: string | null
          content?: string
          created_at?: string
          id?: string
          note?: string | null
          page?: number | null
          source_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlights_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlights_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      indexing_bounties: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          id: string
          organization_id: string
          payment_link: string | null
          price_per_book: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          id?: string
          organization_id: string
          payment_link?: string | null
          price_per_book?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          id?: string
          organization_id?: string
          payment_link?: string | null
          price_per_book?: number
          updated_at?: string
        }
        Relationships: []
      }
      indexing_sessions: {
        Row: {
          book_count: number
          currency: string
          ended_at: string | null
          id: string
          indexer_user_id: string
          owner_user_id: string
          paid: boolean
          paid_at: string | null
          price_per_book: number
          started_at: string
        }
        Insert: {
          book_count?: number
          currency: string
          ended_at?: string | null
          id?: string
          indexer_user_id: string
          owner_user_id: string
          paid?: boolean
          paid_at?: string | null
          price_per_book: number
          started_at?: string
        }
        Update: {
          book_count?: number
          currency?: string
          ended_at?: string | null
          id?: string
          indexer_user_id?: string
          owner_user_id?: string
          paid?: boolean
          paid_at?: string | null
          price_per_book?: number
          started_at?: string
        }
        Relationships: []
      }
      invite_tokens: {
        Row: {
          expires_at: string
          id: string
          owner_user_id: string
          role: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          expires_at?: string
          id: string
          owner_user_id: string
          role?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          expires_at?: string
          id?: string
          owner_user_id?: string
          role?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      nudge_citations: {
        Row: {
          chunk_id: string
          created_at: string
          id: string
          nudge_id: string
          rank: number
          relevance: number
          source_id: string
        }
        Insert: {
          chunk_id: string
          created_at?: string
          id?: string
          nudge_id: string
          rank: number
          relevance: number
          source_id: string
        }
        Update: {
          chunk_id?: string
          created_at?: string
          id?: string
          nudge_id?: string
          rank?: number
          relevance?: number
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nudge_citations_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nudge_citations_nudge_id_fkey"
            columns: ["nudge_id"]
            isOneToOne: false
            referencedRelation: "nudges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nudge_citations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      nudges: {
        Row: {
          cache_hit: boolean
          created_at: string
          id: string
          latency_ms: number | null
          query_text: string
          response_text: string | null
          themes: string[]
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          cache_hit?: boolean
          created_at?: string
          id?: string
          latency_ms?: number | null
          query_text: string
          response_text?: string | null
          themes?: string[]
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          cache_hit?: boolean
          created_at?: string
          id?: string
          latency_ms?: number | null
          query_text?: string
          response_text?: string | null
          themes?: string[]
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: []
      }
      sources: {
        Row: {
          author: string | null
          authority_tier: number
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          ingest_error: string | null
          ingest_status: string
          is_read: boolean
          isbn: string | null
          last_ingested: string | null
          publication_date: string | null
          read_at: string | null
          shelf_location: string | null
          source_type: string
          tags: string[]
          title: string
          total_chunks: number
          updated_at: string
          url: string | null
          user_id: string
          user_rating: number | null
        }
        Insert: {
          author?: string | null
          authority_tier?: number
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          ingest_error?: string | null
          ingest_status?: string
          is_read?: boolean
          isbn?: string | null
          last_ingested?: string | null
          publication_date?: string | null
          read_at?: string | null
          shelf_location?: string | null
          source_type: string
          tags?: string[]
          title: string
          total_chunks?: number
          updated_at?: string
          url?: string | null
          user_id: string
          user_rating?: number | null
        }
        Update: {
          author?: string | null
          authority_tier?: number
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          ingest_error?: string | null
          ingest_status?: string
          is_read?: boolean
          isbn?: string | null
          last_ingested?: string | null
          publication_date?: string | null
          read_at?: string | null
          shelf_location?: string | null
          source_type?: string
          tags?: string[]
          title?: string
          total_chunks?: number
          updated_at?: string
          url?: string | null
          user_id?: string
          user_rating?: number | null
        }
        Relationships: []
      }
      user_memories: {
        Row: {
          citations_used: Json | null
          confidence: number
          content: string
          created_at: string
          embedding: string | null
          expires_at: string | null
          id: string
          last_referenced: string | null
          memory_type: string
          response_summary: string | null
          source_query: string | null
          times_referenced: number
          updated_at: string
          user_id: string
        }
        Insert: {
          citations_used?: Json | null
          confidence?: number
          content: string
          created_at?: string
          embedding?: string | null
          expires_at?: string | null
          id?: string
          last_referenced?: string | null
          memory_type: string
          response_summary?: string | null
          source_query?: string | null
          times_referenced?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          citations_used?: Json | null
          confidence?: number
          content?: string
          created_at?: string
          embedding?: string | null
          expires_at?: string | null
          id?: string
          last_referenced?: string | null
          memory_type?: string
          response_summary?: string | null
          source_query?: string | null
          times_referenced?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          communication_style: string | null
          created_at: string
          current_books: string | null
          digest_email: string | null
          digest_enabled: boolean
          digest_time: string
          display_name: string
          librarian_name: string
          onboarding_completed: boolean
          professional_context: string | null
          reading_preferences: string | null
          semantic_cache_threshold: number
          timezone: string
          topics_md: string | null
          topics_updated_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          communication_style?: string | null
          created_at?: string
          current_books?: string | null
          digest_email?: string | null
          digest_enabled?: boolean
          digest_time?: string
          display_name?: string
          librarian_name?: string
          onboarding_completed?: boolean
          professional_context?: string | null
          reading_preferences?: string | null
          semantic_cache_threshold?: number
          timezone?: string
          topics_md?: string | null
          topics_updated_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          communication_style?: string | null
          created_at?: string
          current_books?: string | null
          digest_email?: string | null
          digest_enabled?: boolean
          digest_time?: string
          display_name?: string
          librarian_name?: string
          onboarding_completed?: boolean
          professional_context?: string | null
          reading_preferences?: string | null
          semantic_cache_threshold?: number
          timezone?: string
          topics_md?: string | null
          topics_updated_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_invite_token: {
        Args: { p_owner_id: string; p_token_id: string }
        Returns: undefined
      }
      increment_session_book_count: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: Json
      }
      match_chunks: {
        Args: {
          p_match_count?: number
          p_min_score?: number
          p_query_embedding: string
          p_source_types?: string[]
          p_user_id: string
        }
        Returns: {
          author: string
          authority_tier: number
          chapter_title: string
          chunk_id: string
          chunk_type: string
          content: string
          similarity: number
          source_id: string
          source_type: string
          title: string
        }[]
      }
      match_memories: {
        Args: {
          p_min_score?: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          citations_used: Json
          content: string
          memory_id: string
          response_summary: string
          similarity: number
        }[]
      }
      redeem_invite: {
        Args: { p_token: string; p_user_id: string }
        Returns: Json
      }
      upsert_bounty_config: {
        Args: {
          p_currency: string
          p_payment_link: string
          p_price: number
          p_user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
