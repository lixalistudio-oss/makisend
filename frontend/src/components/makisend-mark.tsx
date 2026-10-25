/** The MakiSend symbol: one stroke that draws the envelope and, where the flap folds in, the M (same mark as /brand/makisend-symbol.svg and the favicon). */
export function MakiSendMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path
        d="M7 21V11h3.2L16 16.6 21.8 11H25v10Z"
        fill="none"
        stroke="var(--brand-foreground)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
