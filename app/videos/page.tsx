import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import VideosBrowser from "@/components/videos-browser";

export const dynamic = "force-dynamic";

type Sort = "added" | "oldest" | "title" | "views" | "duration";
const SORTS: Sort[] = ["added", "oldest", "title", "views", "duration"];

// 18+ long-form video library (VIDEOS_ROOT/adults). The section layout enforces
// the personal-PIN gate; the API re-checks it on every request.
export default async function Videos18Page(props: {
  searchParams: Promise<{ folder?: string; q?: string; sort?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  const sp = await props.searchParams;
  const sort = SORTS.includes(sp.sort as Sort) ? (sp.sort as Sort) : "added";

  return (
    <VideosBrowser
      channel="adults"
      basePath="/videos"
      title="Videos 18+"
      isAdmin={session.role === "admin"}
      initialFolder={sp.folder || ""}
      initialQuery={sp.q || ""}
      initialSort={sort}
    />
  );
}
