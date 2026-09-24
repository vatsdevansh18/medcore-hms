"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { DownloadUrlView } from "@medcore/types";
import { Button, type ButtonProps } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { toast } from "./toaster";

/**
 * Fetches a short-lived pre-signed URL (SEC-FILE-003) only when clicked,
 * then opens it. The URL is never rendered into the page ahead of time, so
 * it can't go stale while the page sits open.
 */
export function DownloadButton({
  fetchUrl,
  label,
  ...props
}: { fetchUrl: () => Promise<DownloadUrlView>; label: string } & Omit<ButtonProps, "onClick">) {
  const [pending, setPending] = useState(false);
  async function handleClick() {
    setPending(true);
    // Opened synchronously inside the click, or popup blockers stop it;
    // pointed at the file once the URL arrives.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const { downloadUrl } = await fetchUrl();
      if (tab) tab.location.href = downloadUrl;
      else window.location.assign(downloadUrl);
    } catch (error) {
      tab?.close();
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={handleClick} loading={pending} {...props}>
      {!pending && <Download aria-hidden="true" />}
      {label}
    </Button>
  );
}
