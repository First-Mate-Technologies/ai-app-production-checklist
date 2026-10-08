// FIXTURE: trusts the body without verifying the signature.
import Stripe from "stripe";

export async function POST(req: Request) {
  const event = (await req.json()) as Stripe.Event;
  if (event.type === "checkout.session.completed") {
    // mark the order paid
  }
  return new Response("ok");
}
