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
      campus: {
        Row: {
          ciudad: string
          id: number
          nombre: string
          universidad_id: number
        }
        Insert: {
          ciudad: string
          id?: never
          nombre: string
          universidad_id: number
        }
        Update: {
          ciudad?: string
          id?: never
          nombre?: string
          universidad_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "campus_universidad_id_fkey"
            columns: ["universidad_id"]
            isOneToOne: false
            referencedRelation: "universidades"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          id: number
          nombre: string
        }
        Insert: {
          id?: never
          nombre: string
        }
        Update: {
          id?: never
          nombre?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          listing_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          listing_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          listing_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_contacts: {
        Row: {
          created_at: string
          id: number
          listing_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          listing_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          listing_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_contacts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_photos: {
        Row: {
          created_at: string
          id: number
          listing_id: number
          orden: number
          storage_url: string
        }
        Insert: {
          created_at?: string
          id?: never
          listing_id: number
          orden?: number
          storage_url: string
        }
        Update: {
          created_at?: string
          id?: never
          listing_id?: number
          orden?: number
          storage_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          campus_id: number
          categoria_id: number
          condicion: Database["public"]["Enums"]["listing_condition"]
          created_at: string
          descripcion: string | null
          estado: Database["public"]["Enums"]["listing_status"]
          id: number
          precio: number
          titulo: string
          universidad_id: number
          updated_at: string
          user_id: string
          vistas_count: number
        }
        Insert: {
          campus_id: number
          categoria_id: number
          condicion: Database["public"]["Enums"]["listing_condition"]
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["listing_status"]
          id?: never
          precio: number
          titulo: string
          universidad_id: number
          updated_at?: string
          user_id: string
          vistas_count?: number
        }
        Update: {
          campus_id?: number
          categoria_id?: number
          condicion?: Database["public"]["Enums"]["listing_condition"]
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["listing_status"]
          id?: never
          precio?: number
          titulo?: string
          universidad_id?: number
          updated_at?: string
          user_id?: string
          vistas_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "listings_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_universidad_id_fkey"
            columns: ["universidad_id"]
            isOneToOne: false
            referencedRelation: "universidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          comentario: string | null
          created_at: string
          estrellas: number
          from_user_id: string
          id: number
          listing_id: number
          to_user_id: string
        }
        Insert: {
          comentario?: string | null
          created_at?: string
          estrellas: number
          from_user_id: string
          id?: never
          listing_id: number
          to_user_id: string
        }
        Update: {
          comentario?: string | null
          created_at?: string
          estrellas?: number
          from_user_id?: string
          id?: never
          listing_id?: number
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          comentario: string | null
          created_at: string
          estado: Database["public"]["Enums"]["report_status"]
          id: number
          listing_id: number | null
          listing_titulo: string | null
          motivo: Database["public"]["Enums"]["report_reason"]
          reported_user_correo: string | null
          reported_user_id: string | null
          reporter_id: string
          resolved_at: string | null
        }
        Insert: {
          comentario?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["report_status"]
          id?: never
          listing_id?: number | null
          listing_titulo?: string | null
          motivo: Database["public"]["Enums"]["report_reason"]
          reported_user_correo?: string | null
          reported_user_id?: string | null
          reporter_id: string
          resolved_at?: string | null
        }
        Update: {
          comentario?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["report_status"]
          id?: never
          listing_id?: number | null
          listing_titulo?: string | null
          motivo?: Database["public"]["Enums"]["report_reason"]
          reported_user_correo?: string | null
          reported_user_id?: string | null
          reporter_id?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      universidades: {
        Row: {
          id: number
          nombre: string
        }
        Insert: {
          id?: never
          nombre: string
        }
        Update: {
          id?: never
          nombre?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          campus_id: number | null
          carrera: string | null
          correo: string
          created_at: string
          estado: Database["public"]["Enums"]["user_status"]
          foto_url: string | null
          id: string
          nombre: string | null
          rating_promedio: number
          universidad_id: number | null
        }
        Insert: {
          campus_id?: number | null
          carrera?: string | null
          correo: string
          created_at?: string
          estado?: Database["public"]["Enums"]["user_status"]
          foto_url?: string | null
          id: string
          nombre?: string | null
          rating_promedio?: number
          universidad_id?: number | null
        }
        Update: {
          campus_id?: number | null
          carrera?: string | null
          correo?: string
          created_at?: string
          estado?: Database["public"]["Enums"]["user_status"]
          foto_url?: string | null
          id?: string
          nombre?: string | null
          rating_promedio?: number
          universidad_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "users_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_universidad_id_fkey"
            columns: ["universidad_id"]
            isOneToOne: false
            referencedRelation: "universidades"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_listing_view: {
        Args: { p_listing_id: number }
        Returns: undefined
      }
    }
    Enums: {
      listing_condition: "nuevo" | "como_nuevo" | "buen_estado" | "usado"
      listing_status: "activa" | "pausada" | "vendida"
      report_reason:
        | "spam_publicidad"
        | "sospecha_fraude"
        | "contenido_inapropiado"
        | "no_es_estudiante"
        | "otro"
      report_status: "pendiente" | "resuelto" | "descartado"
      user_status: "activo" | "suspendido"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      listing_condition: ["nuevo", "como_nuevo", "buen_estado", "usado"],
      listing_status: ["activa", "pausada", "vendida"],
      report_reason: [
        "spam_publicidad",
        "sospecha_fraude",
        "contenido_inapropiado",
        "no_es_estudiante",
        "otro",
      ],
      report_status: ["pendiente", "resuelto", "descartado"],
      user_status: ["activo", "suspendido"],
    },
  },
} as const
