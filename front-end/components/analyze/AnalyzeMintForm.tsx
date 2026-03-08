"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

interface AnalyzeMintFormProps {
  onAnalyze: (mint: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function AnalyzeMintForm({ onAnalyze, isLoading, className }: AnalyzeMintFormProps) {
  const [mint, setMint] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mint.trim()) {
      onAnalyze(mint.trim());
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}
    >
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8B93A7]" />
        <Input
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          placeholder="Enter mint address to analyze..."
          className="h-12 pl-10"
          disabled={isLoading}
        />
      </div>
      <Button
        type="submit"
        disabled={isLoading || !mint.trim()}
        className="h-12 min-w-[140px] bg-[#2EC3E5] text-[#0B0D10] font-medium hover:bg-[#2EC3E5]/90"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Analyzing...
          </>
        ) : (
          <>
            <Search className="mr-2 h-4 w-4" />
            Analyze
          </>
        )}
      </Button>
    </form>
  );
}
