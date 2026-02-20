import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  credits: number;
  promo?: string;
  success_url: string;
  cancel_url: string;
};

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try{
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    if(!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } }
    });

    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return new Response(JSON.stringify({ error:"Not authed" }), { status: 401, headers: { ...corsHeaders, "content-type":"application/json" } });

    const body = (await req.json()) as ReqBody;
    const credits = Math.max(1, Math.floor(Number(body.credits || 0)));
    const amountCents = credits * 100; // $1 = 1 credit

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: body.success_url,
      cancel_url: body.cancel_url,
      customer_email: user.email ?? undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: { name: `CreatorBook Credits (${credits})` },
        }
      }],
      metadata: { user_id: user.id, credits: String(credits), promo: body.promo ?? "" }
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "content-type":"application/json" }
    });
  }catch(e){
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "content-type":"application/json" }
    });
  }
});
