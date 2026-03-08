"use client";

import { useAnalyzeMint } from "@/lib/hooks";
import { PageHeader } from "@/components/shell/PageHeader";
import { AnalyzeMintForm } from "@/components/analyze/AnalyzeMintForm";
import { AnalyzeReportView } from "@/components/analyze/AnalyzeReportView";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast, Toaster } from "sonner";

export default function AnalyzePage() {
  const analyzeMutation = useAnalyzeMint();

  const handleAnalyze = async (mint: string) => {
    try {
      await analyzeMutation.mutateAsync({ mint });
      toast.success("Analysis complete");
    } catch {
      toast.error("Failed to analyze mint");
    }
  };

  return (
    <div className="space-y-6">
      <Toaster position="top-right" theme="dark" />
      <PageHeader
        title="Analyze"
        description="Analyze token risk and opportunity scores"
      />

      <SectionFrame>
        <div className="p-4">
          <AnalyzeMintForm
            onAnalyze={handleAnalyze}
            isLoading={analyzeMutation.isPending}
          />
        </div>
      </SectionFrame>

      {analyzeMutation.data ? (
        <AnalyzeReportView report={analyzeMutation.data.report} />
      ) : (
        <SectionFrame>
          <EmptyState
            title="No analysis yet"
            description="Enter a mint address above to analyze its risk profile"
          />
        </SectionFrame>
      )}
    </div>
  );
}
