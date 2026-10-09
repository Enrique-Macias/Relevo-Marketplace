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
  admin: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agregar_dominio: {
        Args: { p_dominio: string; p_motivo: string; p_universidad_id: number }
        Returns: undefined
      }
      aprobar_listing: {
        Args: { p_id: number; p_motivo: string }
        Returns: string
      }
      bloquear_listing: {
        Args: { p_id: number; p_motivo: string }
        Returns: undefined
      }
      buscar_usuarios: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          campus: string
          correo: string
          created_at: string
          es_admin: boolean
          estado: "activo" | "suspendido"
          id: string
          nombre: string
          publicaciones: number
          reportes_en_contra: number
          suspendido_at: string
          suspension_motivo: string
          universidad: string
        }[]
      }
      catalogo: { Args: never; Returns: Json }
      cola_moderacion: {
        Args: {
          p_cursor?: number
          p_limit?: number
          p_solo_evaluadas?: boolean
        }
        Returns: {
          categoria: string
          created_at: string
          dueno_estado: "activo" | "suspendido"
          dueno_id: string
          dueno_nombre: string
          evaluaciones: number
          fotos: string[]
          id: number
          precio: number
          titulo: string
          ultima_evaluacion_at: string
          ultimo_detalle: Json
          ultimo_veredicto: string
        }[]
      }
      crear_campus: {
        Args: {
          p_ciudad: string
          p_latitud: number
          p_longitud: number
          p_motivo: string
          p_nombre: string
          p_universidad_id: number
        }
        Returns: number
      }
      crear_universidad: {
        Args: { p_motivo: string; p_nombre: string }
        Returns: number
      }
      desactivar_dominio: {
        Args: { p_dominio: string; p_motivo: string }
        Returns: undefined
      }
      detalle_listing: { Args: { p_id: number }; Returns: Json }
      detalle_usuario: { Args: { p_user_id: string }; Returns: Json }
      editar_campus: {
        Args: {
          p_ciudad: string
          p_id: number
          p_latitud: number
          p_longitud: number
          p_motivo: string
          p_nombre: string
        }
        Returns: undefined
      }
      editar_universidad: {
        Args: { p_id: number; p_motivo: string; p_nombre: string }
        Returns: undefined
      }
      listar_reportes: {
        Args: { p_cursor?: number; p_estado?: string; p_limit?: number }
        Returns: {
          comentario: string
          created_at: string
          estado: "pendiente" | "resuelto" | "descartado"
          id: number
          listing_estado:
            | "activa"
            | "pausada"
            | "vendida"
            | "pendiente"
            | "bloqueada"
          listing_id: number
          listing_titulo: string
          motivo:
            | "spam_publicidad"
            | "sospecha_fraude"
            | "contenido_inapropiado"
            | "no_es_estudiante"
            | "otro"
          objetivo_tipo: string
          reported_user_correo: string
          reported_user_estado: "activo" | "suspendido"
          reported_user_id: string
          reported_user_nombre: string
          reporter_id: string
          reporter_nombre: string
          reportes_mismo_objetivo: number
          resolved_at: string
        }[]
      }
      reactivar_dominio: {
        Args: { p_dominio: string; p_motivo: string }
        Returns: undefined
      }
      reactivar_usuario: {
        Args: { p_motivo: string; p_user_id: string }
        Returns: undefined
      }
      resolver_reporte: {
        Args: { p_estado: string; p_id: number; p_motivo: string }
        Returns: undefined
      }
      restablecer_mfa_completar: {
        Args: { p_accion_id: number }
        Returns: Json
      }
      restablecer_mfa_iniciar: {
        Args: {
          p_intento_pendiente?: number
          p_motivo: string
          p_user_id: string
        }
        Returns: Json
      }
      sesion: { Args: never; Returns: Json }
      suspender_usuario: {
        Args: { p_motivo: string; p_user_id: string }
        Returns: number
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
  admin: {
    Enums: {},
  },
} as const
