// Flat terminal-style emblem: a balance scale in a hairline ring, one green status dot.
export function EuthynaMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Euthyna">
      <circle cx="50" cy="50" r="48" fill="#2a2a28" />
      <circle cx="50" cy="50" r="43" fill="#0f0f0f" />
      {/* balance scale — euthyna is the Athenian audit an official faced on leaving office */}
      <g fill="none" stroke="#eaeaea" strokeWidth="3.4" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M50 28 V72" />
        <path d="M38 74 H62" />
        <path d="M28 36 H72" />
        <path d="M28 36 L20 54 H36 Z" />
        <path d="M72 36 L64 54 H80 Z" />
      </g>
      <circle cx="50" cy="26" r="4" fill="#4af626" />
    </svg>
  );
}
