import '@sales-automation/evaluator';

declare module '@sales-automation/evaluator' {
  interface LeadEvaluation {
    /**
     * Historical records may retain this field from an older evaluation envelope.
     * Current evaluator output does not guarantee it, so commercial analytics must
     * treat it only as an optional fallback and never synthesize a timestamp.
     */
    generatedAt?: string;
  }
}
