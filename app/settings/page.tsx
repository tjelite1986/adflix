import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import JobsManager from "@/components/jobs-manager";

export const dynamic = "force-dynamic";

// Admin only: the background jobs are the one thing here to configure. The
// library itself is managed from the video pages (rescan, convert, match).
export default async function SettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/videos");

  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-6 text-white">
      <h1 className="mb-4 px-1 text-lg font-semibold">Background jobs</h1>
      <JobsManager />
    </div>
  );
}
