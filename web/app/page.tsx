import { SetupForm } from "@/components/SetupForm";

/**
 * Home / setup page. Pick an idea + a judge panel, then kick off a run.
 * The form (and its data fetching) is client-side; see {@link SetupForm}.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Judge Me <span className="text-accent">Bro</span>
        </h1>
        <p className="text-muted">
          Pick an idea and assemble a panel of judges, then let them score it and
          meta-judge each other.
        </p>
      </header>

      <SetupForm />
    </main>
  );
}
