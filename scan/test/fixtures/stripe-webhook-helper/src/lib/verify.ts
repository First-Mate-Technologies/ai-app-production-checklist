// FIXTURE: verification lives in a helper, not in the route file.
import Stripe from "stripe";

export function verify(body: string, sig: string) {
  return new Stripe("x").webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
}
