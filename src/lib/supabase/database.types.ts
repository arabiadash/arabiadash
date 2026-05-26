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
      connections: {
        Row: {
          access_token: string | null
          account_id: string
          account_name: string | null
          connected_at: string | null
          created_at: string
          id: number
          last_synced_at: string | null
          metadata: Json | null
          platform: string
          scopes: string[] | null
          status: string | null
          token_expires_at: string | null
          updated_at: string | null
          user_id: string
          workspace_id: number
        }
        Insert: {
          access_token?: string | null
          account_id: string
          account_name?: string | null
          connected_at?: string | null
          created_at?: string
          id?: number
          last_synced_at?: string | null
          metadata?: Json | null
          platform: string
          scopes?: string[] | null
          status?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id: string
          workspace_id: number
        }
        Update: {
          access_token?: string | null
          account_id?: string
          account_name?: string | null
          connected_at?: string | null
          created_at?: string
          id?: number
          last_synced_at?: string | null
          metadata?: Json | null
          platform?: string
          scopes?: string[] | null
          status?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string
          workspace_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connections_pending_backup_2026_05_18: {
        Row: {
          access_token: string | null
          account_id: string | null
          account_name: string | null
          backed_up_at: string | null
          connected_at: string | null
          created_at: string | null
          id: number | null
          last_synced_at: string | null
          metadata: Json | null
          platform: string | null
          scopes: string[] | null
          status: string | null
          token_expires_at: string | null
          updated_at: string | null
          user_id: string | null
          workspace_id: number | null
        }
        Insert: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          backed_up_at?: string | null
          connected_at?: string | null
          created_at?: string | null
          id?: number | null
          last_synced_at?: string | null
          metadata?: Json | null
          platform?: string | null
          scopes?: string[] | null
          status?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: number | null
        }
        Update: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          backed_up_at?: string | null
          connected_at?: string | null
          created_at?: string | null
          id?: number | null
          last_synced_at?: string | null
          metadata?: Json | null
          platform?: string | null
          scopes?: string[] | null
          status?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: number | null
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string | null
          id: number
          is_read: boolean | null
          message: string | null
          name: string | null
          responded: boolean | null
          subject: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: number
          is_read?: boolean | null
          message?: string | null
          name?: string | null
          responded?: boolean | null
          subject?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: number
          is_read?: boolean | null
          message?: string | null
          name?: string | null
          responded?: boolean | null
          subject?: string | null
        }
        Relationships: []
      }
      creatives_cache: {
        Row: {
          account_id: string
          data: Json
          date_range: string
          fetched_at: string
          fresh_until: string
          id: string
          provider: string
          stale_until: string
          user_id: string
        }
        Insert: {
          account_id: string
          data: Json
          date_range: string
          fetched_at?: string
          fresh_until: string
          id?: string
          provider: string
          stale_until: string
          user_id: string
        }
        Update: {
          account_id?: string
          data?: Json
          date_range?: string
          fetched_at?: string
          fresh_until?: string
          id?: string
          provider?: string
          stale_until?: string
          user_id?: string
        }
        Relationships: []
      }
      google_conversion_actions: {
        Row: {
          category: number
          category_name: string
          conversion_action_id: string
          counts_as_purchase: boolean
          created_at: string
          customer_id: string
          id: number
          name: string
          primary_for_goal: boolean
          resource_name: string
          status: number
          synced_at: string
          updated_at: string
          user_id: string
          user_override: boolean | null
        }
        Insert: {
          category: number
          category_name: string
          conversion_action_id: string
          counts_as_purchase: boolean
          created_at?: string
          customer_id: string
          id?: number
          name: string
          primary_for_goal?: boolean
          resource_name: string
          status: number
          synced_at?: string
          updated_at?: string
          user_id: string
          user_override?: boolean | null
        }
        Update: {
          category?: number
          category_name?: string
          conversion_action_id?: string
          counts_as_purchase?: boolean
          created_at?: string
          customer_id?: string
          id?: number
          name?: string
          primary_for_goal?: boolean
          resource_name?: string
          status?: number
          synced_at?: string
          updated_at?: string
          user_id?: string
          user_override?: boolean | null
        }
        Relationships: []
      }
      insights_cache: {
        Row: {
          cache_key: string
          connection_id: number
          created_at: string | null
          data: Json
          expires_at: string
          fetched_at: string
          fresh_until: string
          id: number
          provider: string
          stale_until: string
        }
        Insert: {
          cache_key: string
          connection_id: number
          created_at?: string | null
          data: Json
          expires_at: string
          fetched_at?: string
          fresh_until: string
          id?: number
          provider?: string
          stale_until: string
        }
        Update: {
          cache_key?: string
          connection_id?: number
          created_at?: string | null
          data?: Json
          expires_at?: string
          fetched_at?: string
          fresh_until?: string
          id?: number
          provider?: string
          stale_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_cache_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_insights_cache: {
        Row: {
          cache_key: string
          connection_id: number
          created_at: string | null
          data: Json
          expires_at: string
          fetched_at: string
          id: number
        }
        Insert: {
          cache_key: string
          connection_id: number
          created_at?: string | null
          data: Json
          expires_at: string
          fetched_at?: string
          id?: number
        }
        Update: {
          cache_key?: string
          connection_id?: number
          created_at?: string | null
          data?: Json
          expires_at?: string
          fetched_at?: string
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "meta_insights_cache_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_credentials: {
        Row: {
          created_at: string
          expires_at: string | null
          id: number
          platform: string
          refresh_token: string
          scopes: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: number
          platform: string
          refresh_token: string
          scopes?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: number
          platform?: string
          refresh_token?: string
          scopes?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          preferred_currency: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          preferred_currency?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          preferred_currency?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          archived_at: string | null
          created_at: string
          icon: string | null
          id: number
          is_default: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          icon?: string | null
          id?: number
          is_default?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          icon?: string | null
          id?: number
          is_default?: boolean
          name?: string
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
      [_ in never]: never
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
