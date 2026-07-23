import { DashboardView } from "@/components/dashboard/dashboard-view";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function DashboardPage() {
  return (
    <DashboardShell>
      <div className="mx-auto w-full max-w-[100rem] space-y-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <PageHeader
          title="Operations dashboard"
          description="A read-only view of your current shift, today's orders, and stock requiring attention."
          breadcrumbs={[
            { label: "GroceryRMS", href: "/" },
            { label: "Dashboard" },
          ]}
        />
        <DashboardView />
      </div>
    </DashboardShell>
  );
}
