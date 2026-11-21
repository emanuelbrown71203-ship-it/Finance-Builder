"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
