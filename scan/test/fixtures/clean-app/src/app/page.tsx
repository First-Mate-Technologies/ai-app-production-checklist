export default function Page() {
  return <p>{process.env.NEXT_PUBLIC_SUPABASE_URL}</p>;
}
