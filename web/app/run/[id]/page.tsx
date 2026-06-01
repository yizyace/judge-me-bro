import { RunView } from "@/components/RunView";

/**
 * The run page. A thin server shell: it unwraps the dynamic `[id]` param and
 * hands off to the client {@link RunView}, which subscribes to the run stream
 * (or renders a completed/seeded run straight from its persisted artefacts).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunView runId={id} />;
}
