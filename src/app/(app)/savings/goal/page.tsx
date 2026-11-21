import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { GoalScreen } from "./goal-screen";

export default function GoalPage() {
  return (
    <Suspense
      fallback={
        <div className="grid grid-cols-1 gap-5">
          <Skeleton className="h-72 rounded-sheet" />
          <Skeleton className="h-64 rounded-sheet" />
        </div>
      }
    >
      <GoalScreen />
    </Suspense>
  );
}
