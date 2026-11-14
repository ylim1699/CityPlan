/* Round × button for hiding a panel or dismissing an item; label says what it hides (tooltip and screen readers) */
export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="iconx" aria-label={label} title={label} onClick={onClick}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
  </button>;
}
