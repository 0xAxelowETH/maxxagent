import { MaxxLoader } from "@/components/MaxxLoader";

/** Shown while a server-rendered page (index factsheet, stock page, preview…) is being prepared */
export default function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center bg-[#03060e]">
      <MaxxLoader size={56} label="Reading live onchain data…" className="flex-col !gap-3 text-sm" />
    </div>
  );
}
