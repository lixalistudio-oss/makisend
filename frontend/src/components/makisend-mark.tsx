/** The MakiSend envelope on a green tile (same mark as the favicon and the website). */
export function MakiSendMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path
        d="M7 11.5 16 17.5l9-6M7.5 10h17a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 6 20.5v-9A1.5 1.5 0 0 1 7.5 10Z"
        fill="none"
        stroke="var(--brand-foreground)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
