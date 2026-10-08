// FIXTURE: server-only use of the service role. The hard-coded fake key is a MEDIUM, not a HIGH.
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export const legacy = "__JWT_SERVICE_ROLE__";
export const anon = "__JWT_ANON__";

export async function GET() {
  const { data } = await admin.from("orders").select();
  return Response.json(data);
}
