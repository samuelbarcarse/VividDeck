import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

interface SwipeBody {
  card_id?: unknown;
  direction?: unknown;
}

export async function POST(request: Request) {
  let body: SwipeBody;
  try {
    body = (await request.json()) as SwipeBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const cardId = body.card_id;
  const direction = body.direction;
  if (typeof cardId !== "string" || !cardId) {
    return NextResponse.json({ error: "card_id is required" }, { status: 400 });
  }
  if (direction !== 1 && direction !== -1) {
    return NextResponse.json({ error: "direction must be 1 or -1" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { error } = await supabase.rpc("record_swipe", { p_card_id: cardId, p_direction: direction });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
