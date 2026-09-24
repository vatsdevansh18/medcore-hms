"use client";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { RoleGate } from "@/components/modules/role-gate";
import { OccupancyBoard } from "@/components/modules/charts/occupancy-board";
import { PanelBody } from "@/components/modules/dashboards/common";
import { useOccupancy } from "@/services/staff";
import { ROUTES } from "@/constants";

function Beds() {
  const occupancy = useOccupancy();
  return (
    <>
      <PageHeader title="Bed board" description="Every bed by ward and room. Refreshes every minute." />
      <Card>
        <CardBody>
          <PanelBody query={occupancy} empty="No wards are set up." isEmpty={(o) => o.departments.length === 0} rows={6}>
            {(data) => <OccupancyBoard data={data} />}
          </PanelBody>
        </CardBody>
      </Card>
    </>
  );
}

export default function BedsPage() {
  return (
    <RoleGate route={ROUTES.beds}>
      <Beds />
    </RoleGate>
  );
}
