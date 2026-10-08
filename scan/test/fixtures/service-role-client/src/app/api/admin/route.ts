// FIXTURE: an API route is server code, so using the service role here is fine.
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
  const { data } = await admin.from("orders").select();
  return Response.json(data);
}
