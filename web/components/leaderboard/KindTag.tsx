import type { Kind } from "@/lib/schema";

const STYLES: Record<Kind, string> = {
  judge: "bg-[#243b6b] text-[#bcd0ff]",
  founder: "bg-[#314026] text-[#c8e6a0]",
};

/** The FOUNDER / JUDGE pill next to a judge's name. */
export function KindTag({ kind }: { kind: Kind }) {
  return (
    <span
      className={
        "rounded-full px-2 py-[2px] text-[11px] font-bold uppercase tracking-[0.04em] " + STYLES[kind]
      }
    >
      {kind}
    </span>
  );
}
