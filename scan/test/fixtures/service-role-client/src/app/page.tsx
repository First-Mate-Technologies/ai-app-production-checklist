"use client";
// FIXTURE: fake key, not a real credential.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://fakefakefakefake.supabase.co",
  "__JWT_SERVICE_ROLE__",
);

export default function Page() {
  return <button onClick={() => supabase.from("orders").select()}>Orders</button>;
}
