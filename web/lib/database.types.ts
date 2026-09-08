// Generated from the Supabase schema. Regenerate after every migration:
//   npx supabase gen types typescript --project-id dqbtclsbdcglgurchxrb > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      card_prices: {
        Row: {
          card_id: string;
          direct_low_price: number | null;
          high_price: number | null;
          low_price: number | null;
          market_price: number | null;
          mid_price: number | null;
          product_id: number | null;
          synced_at: string;
          updated: string | null;
          variant: string;
        };
        Insert: {
          card_id: string;
          direct_low_price?: number | null;
          high_price?: number | null;
          low_price?: number | null;
          market_price?: number | null;
          mid_price?: number | null;
          product_id?: number | null;
          synced_at?: string;
          updated?: string | null;
          variant: string;
        };
        Update: {
          card_id?: string;
          direct_low_price?: number | null;
          high_price?: number | null;
          low_price?: number | null;
          market_price?: number | null;
          mid_price?: number | null;
          product_id?: number | null;
          synced_at?: string;
          updated?: string | null;
          variant?: string;
        };
        Relationships: [
          {
            foreignKeyName: "card_prices_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
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
          rarity_group: string | null;
          set_id: string | null;
          tcgplayer_product_id: number | null;
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
          rarity_group?: string | null;
          set_id?: string | null;
          tcgplayer_product_id?: number | null;
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
          rarity_group?: string | null;
          set_id?: string | null;
          tcgplayer_product_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "cards_rarity_group_fkey";
            columns: ["rarity_group"];
            isOneToOne: false;
            referencedRelation: "rarity_groups";
            referencedColumns: ["key"];
          },
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
      rarity_groups: {
        Row: { key: string; label: string; sort_order: number };
        Insert: { key: string; label: string; sort_order: number };
        Update: { key?: string; label?: string; sort_order?: number };
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
        Row: { card_id: string; completed_at: string | null; created_at: string; direction: number; user_id: string };
        Insert: {
          card_id: string;
          completed_at?: string | null;
          created_at?: string;
          direction: number;
          user_id: string;
        };
        Update: {
          card_id?: string;
          completed_at?: string | null;
          created_at?: string;
          direction?: number;
          user_id?: string;
        };
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
      card_prices_for: {
        Args: { p_card_id: string };
        Returns: {
          high_price: number;
          low_price: number;
          market_price: number;
          product_id: number;
          updated: string;
          variant: string;
        }[];
      };
      feed_for_user: {
        Args: { p_limit?: number; p_max_price?: number; p_min_price?: number; p_rarities?: string[] };
        Returns: {
          bucket: string;
          id: string;
          illustrator: string;
          image_key: string;
          name: string;
          price_usd: number;
          rarity: string;
          set_name: string;
          tcgplayer_product_id: number;
        }[];
      };
      list_watchlist: {
        Args: { p_limit?: number };
        Returns: {
          card_id: string;
          completed_at: string;
          illustrator: string;
          image_key: string;
          liked_at: string;
          name: string;
          price_usd: number;
          rarity: string;
          set_name: string;
          tcgplayer_product_id: number;
        }[];
      };
      purge_stale_anonymous_users: {
        Args: { p_idle?: string };
        Returns: number;
      };
      record_swipe: {
        Args: { p_card_id: string; p_direction: number };
        Returns: undefined;
      };
      set_cards_completed: {
        Args: { p_card_ids: string[]; p_completed: boolean };
        Returns: number;
      };
      unlike_cards: {
        Args: { p_card_ids: string[] };
        Returns: number;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
