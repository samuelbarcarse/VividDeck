// Generated from the Supabase schema. Regenerate after every migration:
//   npx supabase gen types typescript --project-id dqbtclsbdcglgurchxrb > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      cards: {
        Row: {
          created_at: string | null;
          embedding: string | null;
          id: string;
          illustrator: string | null;
          image_key: string;
          name: string;
          number: string | null;
          price_updated: string | null;
          price_usd: number | null;
          rarity: string | null;
          set_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          embedding?: string | null;
          id: string;
          illustrator?: string | null;
          image_key: string;
          name: string;
          number?: string | null;
          price_updated?: string | null;
          price_usd?: number | null;
          rarity?: string | null;
          set_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          illustrator?: string | null;
          image_key?: string;
          name?: string;
          number?: string | null;
          price_updated?: string | null;
          price_usd?: number | null;
          rarity?: string | null;
          set_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cards_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "sets";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: { created_at: string | null; id: string };
        Insert: { created_at?: string | null; id: string };
        Update: { created_at?: string | null; id?: string };
        Relationships: [];
      };
      sets: {
        Row: {
          card_count: number | null;
          id: string;
          language: string;
          name: string;
          release_date: string | null;
          series: string | null;
        };
        Insert: {
          card_count?: number | null;
          id: string;
          language: string;
          name: string;
          release_date?: string | null;
          series?: string | null;
        };
        Update: {
          card_count?: number | null;
          id?: string;
          language?: string;
          name?: string;
          release_date?: string | null;
          series?: string | null;
        };
        Relationships: [];
      };
      swipes: {
        Row: { card_id: string; created_at: string | null; direction: number; user_id: string };
        Insert: { card_id: string; created_at?: string | null; direction: number; user_id: string };
        Update: { card_id?: string; created_at?: string | null; direction?: number; user_id?: string };
        Relationships: [
          {
            foreignKeyName: "swipes_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "swipes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      taste: {
        Row: {
          disliked_count: number | null;
          disliked_sum: string | null;
          liked_count: number | null;
          liked_sum: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          disliked_count?: number | null;
          disliked_sum?: string | null;
          liked_count?: number | null;
          liked_sum?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          disliked_count?: number | null;
          disliked_sum?: string | null;
          liked_count?: number | null;
          liked_sum?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "taste_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      feed_random: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          illustrator: string;
          image_key: string;
          name: string;
          price_usd: number;
          rarity: string;
          set_name: string;
        }[];
      };
      record_swipe: {
        Args: { p_card_id: string; p_direction: number };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
