import { redirect } from "next/navigation";

// The library lives at /videos, where its watch pages (/videos/<id>) already
// were in elite-v2; the root only points there.
export default function Home() {
  redirect("/videos");
}
