"use client";

import { useMutation } from "@tanstack/react-query";
import { AnalyzeRequest, AnalyzeResponse } from "../types";
import { analyzeMint } from "../api/client";

export function useAnalyzeMint() {
  return useMutation<AnalyzeResponse, Error, AnalyzeRequest>({
    mutationFn: analyzeMint,
  });
}
