import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if(!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return new Response("Missing stripe env", { status: 400 });

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

  const sig = req.headers.get("stripe-signature");
  const payload = await req.text();

  let event: Stripe.Event;
  try{
    event = stripe.webhooks.constructEvent(payload, sig!, STRIPE_WEBHOOK_SECRET);
  }catch(err){
    return new Response(`Webhook Error: ${err}`, { status: 400 });
  }

  if(event.type === "checkout.session.completed"){
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const credits = Number(session.metadata?.credits || 0);

    if(userId && credits > 0){
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: wallet } = await admin.from("credits_wallet").select("*").eq("user_id", userId).maybeSingle();
      const cur = Number(wallet?.balance || 0);
      const next = cur + credits;

      await admin.from("credits_wallet").upsert({ user_id: userId, balance: next }, { onConflict:"user_id" });
      await admin.from("credits_tx").insert({
        user_id: userId,
        kind: "stripe_credit",
        amount: credits,
        note: `Stripe purchase session ${session.id}`
      });
    }
  }

  return new Response("ok", { status: 200 });
});
