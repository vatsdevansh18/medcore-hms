"use client";

import { use } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { LabResultFlag, type LabValueView } from "@medcore/types";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { DownloadButton } from "@/components/shared/download-button";
import { useLabOrder } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { doctorName, formatDate, formatDateTime } from "@/lib/format";
import { ROUTES } from "@/constants";

/** Out-of-range values: word + arrow + colour, never colour alone (§1.3). */
function Flag({ flag }: { flag: LabValueView["flag"] }) {
  if (flag === LabResultFlag.HIGH) {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <ArrowUp className="size-3.5" aria-hidden="true" /> High
      </span>
    );
  }
  if (flag === LabResultFlag.LOW) {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <ArrowDown className="size-3.5" aria-hidden="true" /> Low
      </span>
    );
  }
  if (flag === LabResultFlag.NORMAL) return <span className="text-success">Normal</span>;
  return <span className="text-muted">No reference range</span>;
}

export default function LabReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { timezone } = useHospital();
  const order = useLabOrder(id);
  const back = { href: ROUTES.labReports, label: "Lab reports" };

  if (order.isPending) {
    return (
      <>
        <PageHeader title="Lab report" back={back} />
        <ListSkeleton rows={2} />
      </>
    );
  }
  if (order.isError) {
    return (
      <>
        <PageHeader title="Lab report" back={back} />
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
      </>
    );
  }

  const o = order.data;
  return (
    <>
      <PageHeader
        title={`Lab tests · ${formatDate(o.createdAt, timezone)}`}
        description={o.doctor ? `Ordered by ${doctorName(o.doctor.user)}` : undefined}
        back={back}
      />
      <div className="flex flex-col gap-4">
        {o.items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="text-base">{item.labTest.name}</CardTitle>
              <StatusBadge status={item.status} kind="lab" />
            </CardHeader>
            <CardBody>
              {item.result ? (
                <>
                  {item.result.structuredValues && item.result.structuredValues.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted">
                        <tr>
                          <th scope="col" className="pb-2 font-medium">Test</th>
                          <th scope="col" className="pb-2 font-medium">Result</th>
                          <th scope="col" className="pb-2 font-medium">Range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.result.structuredValues.map((v) => (
                          <tr key={v.parameter} className="border-t border-border">
                            <td className="py-2">{v.parameter}</td>
                            <td className="py-2 font-medium">
                              {v.value} {v.unit}
                            </td>
                            <td className="py-2">
                              <Flag flag={v.flag} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-sm text-muted">The result is in the attached report.</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-subtle">
                    <span>{item.result.approvedAt ? `Approved ${formatDateTime(item.result.approvedAt, timezone)}` : ""}</span>
                    {item.result.downloadUrl && (
                      <DownloadButton
                        label="Open report file"
                        fetchUrl={async () => {
                          // The detail response already carries a fresh
                          // pre-signed link; refetch so it's never stale.
                          const fresh = await order.refetch();
                          const url = fresh.data?.items.find((i) => i.id === item.id)?.result?.downloadUrl;
                          if (!url) throw new Error("The report file is no longer available.");
                          return { downloadUrl: url };
                        }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">
                  The result will appear here once the lab has reviewed and approved it.
                </p>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
